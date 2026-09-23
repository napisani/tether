import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TetherApp } from "./TetherApp";
import type { DaemonEvent } from "../protocol";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(event: DaemonEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }

  fail() {
    this.onerror?.();
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gateway event lifecycle", () => {
  it("uses the ordered event stream and recovers after EventSource reconnects", () => {
    const { unmount } = render(<TetherApp />);
    const events = FakeEventSource.instances[0];

    expect(events.url).toBe("/api/v1/events");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Tether is reconnecting" })).toBeInTheDocument();

    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({
        command: "protocol_info",
        version: 1,
        capabilities: ["bluetooth.pairing"],
      });
      events.emit({ command: "bt_status", available: true });
    });
    expect(screen.getByRole("heading", { name: "Connect your iPhone" })).toBeInTheDocument();

    act(() => events.fail());
    expect(screen.getByRole("heading", { name: "Tether is reconnecting" })).toBeInTheDocument();

    act(() => events.emit({ command: "gateway_status", daemon_connected: true }));
    expect(screen.getByRole("heading", { name: "Connect your iPhone" })).toBeInTheDocument();

    unmount();
    expect(events.closed).toBe(true);
  });

  it("shows command failures returned by the gateway", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    render(<TetherApp />);
    const events = FakeEventSource.instances[0];
    act(() => {
      events.emit({ command: "gateway_status", daemon_connected: true });
      events.emit({
        command: "protocol_info",
        version: 1,
        capabilities: ["bluetooth.pairing"],
      });
      events.emit({ command: "bt_status", available: true });
    });

    const scanButtons = screen.getAllByRole("button", { name: "Scan for iPhone" });
    fireEvent.click(scanButtons.at(-1)!);

    expect(await screen.findByText("Could not ask tetherd to scan.")).toBeInTheDocument();
  });
});
