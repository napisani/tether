import { describe, expect, it } from "vitest";
import type { DaemonEvent } from "../../protocol";
import { initialDevicesState, reduceDevicesEvent } from "./devicesState";

function apply(events: DaemonEvent[]) {
  return events.reduce(reduceDevicesEvent, initialDevicesState);
}

describe("reduceDevicesEvent", () => {
  it("retains discovered phones after BlueZ removes the transient object", () => {
    const state = apply([
      {
        command: "bt_devices",
        devices: [
          {
            address: "40:F6:64:3D:7A:F1",
            name: "40-F6-64-3D-7A-F1",
            apple_nearby: true,
            iphone: false,
            bonded: false,
          },
        ],
      },
      {
        command: "bt_scan_result",
        success: true,
        message: "Bluetooth scan finished.",
      },
      { command: "bt_devices", devices: [] },
    ]);

    expect(state.devices).toHaveLength(1);
    expect(state.scanMessage).toBe("Bluetooth scan finished.");
  });

  it("ignores pairing messages for another browser operation", () => {
    const pairingState = {
      ...initialDevicesState,
      pairing: {
        operationId: "web-current",
        phase: "pairing" as const,
        detail: "Starting pairing.",
      },
    };

    const next = reduceDevicesEvent(pairingState, {
      command: "bt_pair_result",
      operation_id: "web-stale",
      success: false,
      message: "Stale failure",
    });

    expect(next.pairing.detail).toBe("Starting pairing.");
  });

  it("keeps the pairing result when the transient candidate disappears", () => {
    const pairedState = reduceDevicesEvent(
      {
        ...initialDevicesState,
        pairing: {
          operationId: "web-current",
          phase: "pairing" as const,
          detail: "Starting pairing.",
        },
      },
      {
        command: "bt_pair_result",
        operation_id: "web-current",
        success: true,
        message: "Paired with someone’s iPhone.",
      },
    );

    const withoutCandidate = reduceDevicesEvent(pairedState, {
      command: "bt_devices",
      devices: [],
    });

    expect(withoutCandidate.pairing.phase).toBe("complete");
    expect(withoutCandidate.pairing.message).toBe("Paired with someone’s iPhone.");
  });
});
