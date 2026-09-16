import { describe, expect, it } from "vitest";
import { initialState, reduceAppState } from "./state";

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
