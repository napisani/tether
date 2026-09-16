export type GatewayStatusEvent = {
  command: "gateway_status";
  daemon_connected: boolean;
};

export type ProtocolInfoEvent = {
  command: "protocol_info";
  version: number;
  capabilities: string[];
};

export type BluetoothStatusEvent = {
  command: "bt_status";
  available: boolean;
  enabled?: boolean;
  device_address?: string;
  version?: string;
};

export type BluetoothDevice = {
  address: string;
  name: string;
  iphone: boolean;
  paired: boolean;
  bonded: boolean;
  trusted: boolean;
  connected: boolean;
  classic_connected: boolean;
  le_bearer: boolean;
  le_bonded: boolean;
  le_connected: boolean;
  map: boolean;
  pbap: boolean;
  ancs: boolean;
  ancs_notifying: boolean;
};

export type BluetoothDevicesEvent = {
  command: "bt_devices";
  devices: BluetoothDevice[];
};

export type BluetoothConnectionEvent = {
  command: "bt_connection_changed";
  device_present?: boolean;
  device_paired?: boolean;
  classic_connected?: boolean;
  le_available?: boolean;
  le_connected?: boolean;
  map_open?: boolean;
  pbap_open?: boolean;
  ancs_ready?: boolean;
  link_reason?: string;
  profile_reason?: string;
  ancs_reason?: string;
};

export type BluetoothScanResultEvent = {
  command: "bt_scan_result";
  success: boolean;
  message: string;
};

export type BluetoothPairProgressEvent = {
  command: "bt_pair_progress";
  operation_id?: string;
  step: string;
  detail: string;
};

export type BluetoothPairConfirmEvent = {
  command: "bt_pair_confirm_request";
  operation_id?: string;
  code: string;
};

export type BluetoothPairResultEvent = {
  command: "bt_pair_result" | "bt_unpair_result";
  operation_id?: string;
  success: boolean;
  status: string;
  message: string;
  address?: string;
  dual_bond?: boolean;
};

export type DaemonEvent =
  | GatewayStatusEvent
  | ProtocolInfoEvent
  | BluetoothStatusEvent
  | BluetoothDevicesEvent
  | BluetoothConnectionEvent
  | BluetoothScanResultEvent
  | BluetoothPairProgressEvent
  | BluetoothPairConfirmEvent
  | BluetoothPairResultEvent;

export type DaemonCommand =
  | { command: "bt_status" }
  | { command: "bt_list_devices" }
  | { command: "bt_connection" }
  | { command: "bt_scan" }
  | { command: "bt_pair"; address: string; operation_id: string }
  | { command: "bt_pair_confirm"; operation_id: string; accept: boolean }
  | { command: "bt_unpair"; address: string; operation_id: string };
