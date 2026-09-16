import { useEffect, useMemo, useReducer, useState } from "react";
import type { DaemonCommand, DaemonEvent } from "./protocol";
import { initialState, reduceAppState, type AppState } from "./state";
import "./styles.css";

type AppViewProps = {
  state: AppState;
  onScan: () => void;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
  onConfirmPairing: (accept: boolean) => void;
  onResetPairing: () => void;
};

export function App() {
  const [state, dispatch] = useReducer(reduceAppState, initialState);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/state")
      .then(async (response) => {
        if (!response.ok) throw new Error(`state request failed: ${response.status}`);
        return (await response.json()) as {
          daemon_connected: boolean;
          events: Record<string, DaemonEvent>;
        };
      })
      .then((snapshot) => {
        if (!active) return;
        dispatch({ type: "gateway-connected", connected: snapshot.daemon_connected });
        for (const event of Object.values(snapshot.events)) {
          dispatch({ type: "daemon-event", event });
        }
      })
      .catch(() => dispatch({ type: "gateway-connected", connected: false }));

    const events = new EventSource("/api/v1/events");
    events.onerror = () => dispatch({ type: "gateway-connected", connected: false });
    events.onmessage = (message) => {
      try {
        dispatch({ type: "daemon-event", event: JSON.parse(message.data) as DaemonEvent });
      } catch {
        // A future daemon event must not take down the rest of the interface.
      }
    };

    return () => {
      active = false;
      events.close();
    };
  }, []);

  async function send(command: DaemonCommand) {
    const response = await fetch("/api/v1/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(`command failed: ${response.status}`);
  }

  function scan() {
    dispatch({ type: "scan-started" });
    void send({ command: "bt_scan" }).catch(() =>
      dispatch({ type: "scan-failed", message: "Could not ask tetherd to scan." }),
    );
  }

  function pair(address: string) {
    const operationId = crypto.randomUUID();
    dispatch({ type: "pair-started", operationId, address });
    void send({ command: "bt_pair", address, operation_id: operationId }).catch(() =>
      dispatch({ type: "operation-failed", message: "Could not start Bluetooth pairing." }),
    );
  }

  function unpair(address: string) {
    const operationId = crypto.randomUUID();
    dispatch({ type: "unpair-started", operationId, address });
    void send({ command: "bt_unpair", address, operation_id: operationId }).catch(() =>
      dispatch({ type: "operation-failed", message: "Could not remove the Bluetooth pairing." }),
    );
  }

  function confirmPairing(accept: boolean) {
    if (!state.pairing.operationId) return;
    dispatch({ type: "pair-confirmation-sent" });
    void send({
      command: "bt_pair_confirm",
      operation_id: state.pairing.operationId,
      accept,
    }).catch(() => dispatch({ type: "operation-failed", message: "Could not send the pairing confirmation." }));
  }

  return (
    <AppView
      state={state}
      onScan={scan}
      onPair={pair}
      onUnpair={unpair}
      onConfirmPairing={confirmPairing}
      onResetPairing={() => dispatch({ type: "pair-reset" })}
    />
  );
}

export function AppView({
  state,
  onScan,
  onPair,
  onUnpair,
  onConfirmPairing,
  onResetPairing,
}: AppViewProps) {
  const configuredAddress = state.bluetooth?.device_address;
  const initialAddress = configuredAddress || state.devices[0]?.address || "";
  const [selectedAddress, setSelectedAddress] = useState(initialAddress);
  const [forgetAddress, setForgetAddress] = useState<string>();
  const selectedDevice = useMemo(
    () =>
      state.devices.find((device) => device.address === selectedAddress) ??
      state.devices.find((device) => device.address === configuredAddress) ??
      state.devices[0],
    [configuredAddress, selectedAddress, state.devices],
  );
  const connection = state.connection;
  const pairingAvailable = state.protocol?.capabilities.includes("bluetooth.pairing") ?? true;
  const bluetoothAvailable = state.bluetooth?.available ?? false;
  const connected = Boolean(connection?.classic_connected || connection?.le_connected);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Tether">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>Tether</span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <span className="nav-item active">Devices</span>
          <span className="nav-item future" title="Available in a future web release">Messages</span>
          <span className="nav-item future" title="Available in a future web release">Notifications</span>
        </nav>
        <span className={`presence-dot ${connected ? "online" : ""}`} aria-label={connected ? "iPhone connected" : "iPhone disconnected"} />
      </header>

      <main className="workspace">
        <aside className="device-rail">
          <div className="rail-heading">
            <div>
              <span className="eyebrow">Bluetooth</span>
              <h1>Devices</h1>
            </div>
            <button className="icon-button" type="button" onClick={onScan} disabled={state.scanning || !bluetoothAvailable} aria-label="Scan for iPhones">
              <span aria-hidden="true">↻</span>
            </button>
          </div>

          <div className="device-list" aria-live="polite">
            {state.devices.length === 0 ? (
              <div className="empty-device">
                <span className="phone-outline" aria-hidden="true" />
                <strong>No iPhone found</strong>
                <span>Unlock your iPhone and open Settings → Bluetooth.</span>
              </div>
            ) : (
              state.devices.map((device) => (
                <button
                  className={`device-row ${selectedDevice?.address === device.address ? "selected" : ""}`}
                  type="button"
                  key={device.address}
                  onClick={() => setSelectedAddress(device.address)}
                >
                  <span className="device-glyph" aria-hidden="true">▯</span>
                  <span className="device-copy">
                    <strong>{deviceDisplayName(device)}</strong>
                    <small>{device.bonded ? "Paired" : device.iphone ? "Ready to pair" : "Possible iPhone"}</small>
                  </span>
                  <span className={`row-dot ${device.connected ? "online" : ""}`} aria-hidden="true" />
                </button>
              ))
            )}
          </div>

          <button className="scan-button" type="button" onClick={onScan} disabled={state.scanning || !bluetoothAvailable}>
            {state.scanning ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">⌁</span>}
            {state.scanning ? "Scanning…" : "Scan for iPhone"}
          </button>
          {state.scanMessage && <p className="rail-message">{state.scanMessage}</p>}
        </aside>

        <section className="detail-pane">
          {!state.gatewayConnected ? (
            <Notice title="Tether is reconnecting" body="The web interface cannot reach tetherd yet. It will retry automatically." tone="warning" />
          ) : !bluetoothAvailable ? (
            <Notice title="Bluetooth is not ready" body="Complete the host Bluetooth setup, then restart the Tether deployment." tone="warning" />
          ) : selectedDevice ? (
            <DeviceDetail
              state={state}
              device={selectedDevice}
              pairingAvailable={pairingAvailable}
              onPair={onPair}
              onUnpair={setForgetAddress}
              onResetPairing={onResetPairing}
            />
          ) : (
            <Welcome onScan={onScan} scanning={state.scanning} />
          )}
        </section>
      </main>

      <footer className="statusbar">
        <StatusItem icon="◉" label="Gateway" status={state.gatewayConnected ? "connected" : "offline"} active={state.gatewayConnected} />
        <StatusItem
          icon="ᛒ"
          label="Bluetooth"
          status={connected ? "iPhone connected" : bluetoothAvailable ? "ready" : "unavailable"}
          active={bluetoothAvailable}
        />
        <span className="version">{state.bluetooth?.version ? `Tether ${state.bluetooth.version}` : "Tether web"}</span>
      </footer>

      {state.pairing.phase === "confirming" && state.pairing.code && (
        <PairingCodeDialog code={state.pairing.code} onAnswer={onConfirmPairing} />
      )}
      {forgetAddress && (
        <ConfirmForgetDialog
          name={deviceDisplayName(state.devices.find((device) => device.address === forgetAddress))}
          onCancel={() => setForgetAddress(undefined)}
          onConfirm={() => {
            onUnpair(forgetAddress);
            setForgetAddress(undefined);
          }}
        />
      )}
    </div>
  );
}

function DeviceDetail({
  state,
  device,
  pairingAvailable,
  onPair,
  onUnpair,
  onResetPairing,
}: {
  state: AppState;
  device: AppState["devices"][number];
  pairingAvailable: boolean;
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
  onResetPairing: () => void;
}) {
  const connection = state.connection;
  const pairingBusy = state.pairing.phase === "pairing" || state.pairing.phase === "confirming";
  return (
    <div className="device-detail">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">{device.iphone ? "Selected iPhone" : "Possible iPhone"}</span>
          <h2>{deviceDisplayName(device)}</h2>
          <p className="address">{device.address}</p>
        </div>
        <span className={`connection-pill ${device.connected ? "connected" : ""}`}>
          <span className="row-dot online" aria-hidden="true" />
          {device.connected ? "Connected" : device.bonded ? "Paired" : "Not paired"}
        </span>
      </div>

      <section className="status-section" aria-labelledby="connection-status-title">
        <div className="section-heading">
          <h3 id="connection-status-title">Current status</h3>
          <span>Live from tetherd</span>
        </div>
        <div className="status-grid">
          <CapabilityCard label="Classic Bluetooth" detail="Phone link" active={Boolean(connection?.classic_connected)} />
          <CapabilityCard label="Low Energy" detail="Notification link" active={Boolean(connection?.le_connected)} />
          <CapabilityCard label="Messages" detail="MAP" active={Boolean(connection?.map_open)} />
          <CapabilityCard label="Contacts" detail="PBAP" active={Boolean(connection?.pbap_open)} />
          <CapabilityCard label="Notifications" detail="ANCS" active={Boolean(connection?.ancs_ready)} />
        </div>
      </section>

      {(connection?.link_reason || connection?.profile_reason || connection?.ancs_reason) && (
        <div className="diagnostic-note">
          <span aria-hidden="true">i</span>
          <p>{connection.link_reason || connection.profile_reason || connection.ancs_reason}</p>
        </div>
      )}

      {state.pairing.phase !== "idle" && (
        <div className={`pairing-progress ${state.pairing.phase}`} aria-live="polite">
          <span className={pairingBusy ? "spinner" : "progress-symbol"} aria-hidden="true">
            {!pairingBusy && (state.pairing.phase === "complete" ? "✓" : "!")}
          </span>
          <div>
            <strong>{pairingTitle(state.pairing)}</strong>
            <p>{state.pairing.message || state.pairing.detail}</p>
          </div>
          {!pairingBusy && (
            <button type="button" className="text-button" onClick={onResetPairing}>Dismiss</button>
          )}
        </div>
      )}

      <div className="actions">
        {device.bonded ? (
          <button className="secondary-button danger" type="button" onClick={() => onUnpair(device.address)} disabled={pairingBusy}>
            Forget iPhone
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={() => onPair(device.address)} disabled={!pairingAvailable || pairingBusy}>
            Pair over Bluetooth
          </button>
        )}
        {!device.bonded && <p>Keep the iPhone unlocked on its Bluetooth settings screen while pairing.</p>}
      </div>
    </div>
  );
}

function Welcome({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true"><span>ᛒ</span></div>
      <span className="eyebrow">Bluetooth pairing</span>
      <h2>Connect your iPhone</h2>
      <p>Unlock your iPhone, open Settings → Bluetooth, then scan from Tether. Your phone stays in control of the final confirmation.</p>
      <button className="primary-button" type="button" onClick={onScan} disabled={scanning}>
        {scanning ? "Scanning…" : "Scan for iPhone"}
      </button>
    </div>
  );
}

function PairingCodeDialog({ code, onAnswer }: { code: string; onAnswer: (accept: boolean) => void }) {
  return (
    <div className="dialog-backdrop">
      <section className="pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="pairing-dialog-title" aria-label="Confirm pairing code">
        <span className="eyebrow">Security check</span>
        <h2 id="pairing-dialog-title">Does your iPhone show this code?</h2>
        <div className="code-display" aria-label={`Pairing code ${code}`}>
          {code.split("").map((digit, index) => <span key={`${index}-${digit}`}>{digit}</span>)}
        </div>
        <p>Only continue when every digit matches. A different code means this is not the same pairing request.</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" autoFocus onClick={() => onAnswer(false)}>Cancel pairing</button>
          <button className="primary-button" type="button" onClick={() => onAnswer(true)}>Codes match</button>
        </div>
      </section>
    </div>
  );
}

function ConfirmForgetDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop">
      <section className="pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="forget-dialog-title">
        <span className="eyebrow">Remove Bluetooth bond</span>
        <h2 id="forget-dialog-title">Forget {name}?</h2>
        <p>Also remove this computer from the iPhone’s Bluetooth settings before pairing again. Otherwise the phone can keep the old bond.</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" autoFocus onClick={onCancel}>Keep iPhone</button>
          <button className="secondary-button danger" type="button" onClick={onConfirm}>Forget iPhone</button>
        </div>
      </section>
    </div>
  );
}

function deviceDisplayName(device?: AppState["devices"][number]): string {
  if (!device) return "this iPhone";
  const addressAlias = device.address.replaceAll(":", "-");
  if (device.apple_nearby && (!device.name || device.name.toUpperCase() === addressAlias)) {
    return "Nearby Apple device";
  }
  return device.name || "iPhone";
}

function CapabilityCard({ label, detail, active }: { label: string; detail: string; active: boolean }) {
  return (
    <div className={`capability-card ${active ? "active" : ""}`}>
      <span className="capability-state" aria-hidden="true">{active ? "✓" : "—"}</span>
      <div><strong>{label}</strong><small>{active ? "Connected" : detail}</small></div>
    </div>
  );
}

function StatusItem({ icon, label, status, active }: { icon: string; label: string; status: string; active: boolean }) {
  return <span className={`status-item ${active ? "active" : ""}`}><span aria-hidden="true">{icon}</span>{label}: {status}</span>;
}

function Notice({ title, body, tone }: { title: string; body: string; tone: "warning" }) {
  return <div className={`notice ${tone}`}><span aria-hidden="true">!</span><div><h2>{title}</h2><p>{body}</p></div></div>;
}

function pairingTitle(pairing: AppState["pairing"]): string {
  if (pairing.kind === "unpair") {
    if (pairing.phase === "complete") return "iPhone forgotten";
    if (pairing.phase === "error") return "Could not forget iPhone";
    return "Removing pairing";
  }
  if (pairing.phase === "complete") return "Pairing complete";
  if (pairing.phase === "error") return "Pairing did not complete";
  if (pairing.phase === "confirming") return "Waiting for confirmation";
  return "Pairing in progress";
}
