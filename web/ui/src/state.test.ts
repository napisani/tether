import { describe, expect, it } from "vitest";
import { initialState, reduceAppState } from "./state";

describe("device discovery", () => {
  it("keeps an unpaired Apple nearby candidate before iPhone services resolve", () => {
    const state = reduceAppState(initialState, {
      type: "daemon-event",
      event: {
        command: "bt_devices",
        devices: [
          {
            address: "40:F6:64:3D:7A:F1",
            name: "40-F6-64-3D-7A-F1",
            iphone: false,
            apple_nearby: true,
            paired: false,
            bonded: false,
            trusted: false,
            connected: false,
            classic_connected: false,
            le_bearer: true,
            le_bonded: false,
            le_connected: false,
            map: false,
            pbap: false,
            ancs: false,
            ancs_notifying: false,
          },
        ],
      },
    });

    expect(state.devices).toHaveLength(1);
  });

  it("keeps the last anonymous candidates when BlueZ removes them after scanning", () => {
    const candidate = {
      address: "40:F6:64:3D:7A:F1",
      name: "40-F6-64-3D-7A-F1",
      iphone: false,
      apple_nearby: true,
      paired: false,
      bonded: false,
      trusted: false,
      connected: false,
      classic_connected: false,
      le_bearer: true,
      le_bonded: false,
      le_connected: false,
      map: false,
      pbap: false,
      ancs: false,
      ancs_notifying: false,
    };
    let state = reduceAppState(initialState, { type: "scan-started" });
    state = reduceAppState(state, {
      type: "daemon-event",
      event: { command: "bt_devices", devices: [candidate] },
    });
    state = reduceAppState(state, {
      type: "daemon-event",
      event: { command: "bt_scan_result", success: true, message: "Bluetooth scan finished." },
    });
    state = reduceAppState(state, {
      type: "daemon-event",
      event: { command: "bt_devices", devices: [] },
    });

    expect(state.devices).toEqual([candidate]);

    const rescanning = reduceAppState(state, { type: "scan-started" });
    expect(rescanning.devices).toEqual([]);
  });
});

describe("pairing state", () => {
  it("follows one pairing operation from discovery through confirmation", () => {
    let state = reduceAppState(initialState, {
      type: "pair-started",
      operationId: "pair-1",
      address: "38:9C:B2:42:3F:E7",
    });

    state = reduceAppState(state, {
      type: "daemon-event",
      event: {
        command: "bt_pair_progress",
        operation_id: "pair-1",
        step: "pair",
        detail: "Waiting for the iPhone",
      },
    });
    expect(state.pairing).toMatchObject({ phase: "pairing", detail: "Waiting for the iPhone" });

    state = reduceAppState(state, {
      type: "daemon-event",
      event: {
        command: "bt_pair_confirm_request",
        operation_id: "pair-1",
        code: "042731",
      },
    });
    expect(state.pairing).toMatchObject({ phase: "confirming", code: "042731" });

    const unchanged = reduceAppState(state, {
      type: "daemon-event",
      event: {
        command: "bt_pair_result",
        operation_id: "an-old-operation",
        success: false,
        status: "error",
        message: "Stale result",
      },
    });
    expect(unchanged).toBe(state);

    state = reduceAppState(state, {
      type: "daemon-event",
      event: {
        command: "bt_pair_result",
        operation_id: "pair-1",
        success: true,
        status: "paired",
        message: "Paired with Nick’s iPhone.",
      },
    });
    expect(state.pairing).toMatchObject({
      phase: "complete",
      code: undefined,
      message: "Paired with Nick’s iPhone.",
    });
  });
});
