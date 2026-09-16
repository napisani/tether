import type {
  BluetoothConnectionEvent,
  BluetoothDevice,
  BluetoothStatusEvent,
  DaemonEvent,
  ProtocolInfoEvent,
} from "./protocol";

export type PairingPhase = "idle" | "pairing" | "confirming" | "complete" | "error";

export type PairingState = {
  phase: PairingPhase;
  kind?: "pair" | "unpair";
  operationId?: string;
  address?: string;
  step?: string;
  detail?: string;
  code?: string;
  message?: string;
};

export type AppState = {
  gatewayConnected: boolean;
  protocol?: ProtocolInfoEvent;
  bluetooth?: BluetoothStatusEvent;
  connection?: BluetoothConnectionEvent;
  devices: BluetoothDevice[];
  scanning: boolean;
  scanMessage?: string;
  pairing: PairingState;
};

export const initialState: AppState = {
  gatewayConnected: false,
  devices: [],
  scanning: false,
  pairing: { phase: "idle" },
};

export type AppAction =
  | { type: "gateway-connected"; connected: boolean }
  | { type: "scan-started" }
  | { type: "pair-started"; operationId: string; address: string }
  | { type: "unpair-started"; operationId: string; address: string }
  | { type: "pair-confirmation-sent" }
  | { type: "operation-failed"; message: string }
  | { type: "scan-failed"; message: string }
  | { type: "pair-reset" }
  | { type: "daemon-event"; event: DaemonEvent };

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "gateway-connected":
      return { ...state, gatewayConnected: action.connected };
    case "scan-started":
      return { ...state, scanning: true, scanMessage: "Looking for nearby iPhones…" };
    case "pair-started":
      return {
        ...state,
        pairing: {
          phase: "pairing",
          kind: "pair",
          operationId: action.operationId,
          address: action.address,
          detail: "Starting Bluetooth pairing…",
        },
      };
    case "unpair-started":
      return {
        ...state,
        pairing: {
          phase: "pairing",
          kind: "unpair",
          operationId: action.operationId,
          address: action.address,
          detail: "Removing the Bluetooth pairing…",
        },
      };
    case "pair-confirmation-sent":
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: "pairing",
          code: undefined,
          detail: "Waiting for the iPhone to finish pairing…",
        },
      };
    case "operation-failed":
      return {
        ...state,
        pairing: { ...state.pairing, phase: "error", code: undefined, detail: undefined, message: action.message },
      };
    case "scan-failed":
      return { ...state, scanning: false, scanMessage: action.message };
    case "pair-reset":
      return { ...state, pairing: { phase: "idle" } };
    case "daemon-event":
      return reduceDaemonEvent(state, action.event);
  }
}

function reduceDaemonEvent(state: AppState, event: DaemonEvent): AppState {
  switch (event.command) {
    case "gateway_status":
      return { ...state, gatewayConnected: event.daemon_connected };
    case "protocol_info":
      return { ...state, protocol: event as ProtocolInfoEvent };
    case "bt_status":
      return { ...state, bluetooth: event as BluetoothStatusEvent };
    case "bt_devices":
      return { ...state, devices: event.devices.filter((device) => device.iphone) };
    case "bt_connection_changed":
      return { ...state, connection: event as BluetoothConnectionEvent };
    case "bt_scan_result":
      return { ...state, scanning: false, scanMessage: event.message };
    case "bt_pair_progress":
      if (!belongsToActivePairing(state.pairing, event.operation_id)) return state;
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: "pairing",
          step: event.step,
          detail: event.detail,
          code: undefined,
        },
      };
    case "bt_pair_confirm_request":
      if (!belongsToActivePairing(state.pairing, event.operation_id)) return state;
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: "confirming",
          code: event.code,
          detail: "Compare this code with the code shown on your iPhone.",
        },
      };
    case "bt_pair_result":
    case "bt_unpair_result":
      if (!belongsToActivePairing(state.pairing, event.operation_id)) return state;
      return {
        ...state,
        pairing: {
          ...state.pairing,
          phase: event.success ? "complete" : "error",
          message: event.message,
          code: undefined,
          detail: undefined,
        },
      };
    default:
      return state;
  }
}

function belongsToActivePairing(pairing: PairingState, operationId?: string): boolean {
  return !operationId || operationId === pairing.operationId;
}
