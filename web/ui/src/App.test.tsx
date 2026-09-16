import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppView } from "./App";
import type { AppState } from "./state";

const pairedState: AppState = {
  gatewayConnected: true,
  protocol: {
    command: "protocol_info",
    version: 1,
    capabilities: ["bluetooth.pairing", "bluetooth.connection"],
  },
  bluetooth: {
    command: "bt_status",
    available: true,
    device_address: "38:9C:B2:42:3F:E7",
    version: "0.2.32-test",
  },
  connection: {
    command: "bt_connection_changed",
    device_present: true,
    device_paired: true,
    classic_connected: true,
    le_available: true,
    le_connected: true,
    map_open: true,
    pbap_open: true,
    ancs_ready: true,
  },
  devices: [
    {
      address: "38:9C:B2:42:3F:E7",
      name: "Nick’s iPhone",
      iphone: true,
      paired: true,
      bonded: true,
      trusted: true,
      connected: true,
      classic_connected: true,
      le_bearer: true,
      le_bonded: true,
      le_connected: true,
      map: true,
      pbap: true,
      ancs: true,
      ancs_notifying: true,
    },
  ],
  scanning: false,
  pairing: {
    phase: "confirming",
    operationId: "pair-1",
    address: "38:9C:B2:42:3F:E7",
    code: "042731",
  },
};

describe("guided pairing view", () => {
  it("shows current transport status and requires explicit code confirmation", () => {
    const confirmPairing = vi.fn();
    render(
      <AppView
        state={pairedState}
        onScan={vi.fn()}
        onPair={vi.fn()}
        onUnpair={vi.fn()}
        onConfirmPairing={confirmPairing}
        onResetPairing={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Nick’s iPhone" })).toBeInTheDocument();
    expect(screen.getAllByText("Messages").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Notifications").length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Does your iPhone show this code?" })).toHaveTextContent("042731");

    fireEvent.click(screen.getByRole("button", { name: "Codes match" }));
    expect(confirmPairing).toHaveBeenCalledWith(true);
  });

  it("requires confirmation before forgetting a bonded iPhone", () => {
    const unpair = vi.fn();
    render(
      <AppView
        state={{ ...pairedState, pairing: { phase: "idle" } }}
        onScan={vi.fn()}
        onPair={vi.fn()}
        onUnpair={unpair}
        onConfirmPairing={vi.fn()}
        onResetPairing={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forget iPhone" }));
    expect(unpair).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Forget Nick’s iPhone?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Forget iPhone" }));
    expect(unpair).toHaveBeenCalledWith("38:9C:B2:42:3F:E7");
  });
});
