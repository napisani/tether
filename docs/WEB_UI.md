# Web interface architecture

The web interface is a client of `tetherd`, not a second implementation of Tether.
Its first release covers guided Bluetooth pairing and current connection status.
Messages, contacts, notifications, calls, files, and settings can be added without
changing the transport shape.

## Modules and seams

```text
Browser (React + TypeScript)
  | POST /api/v1/commands
  | GET  /api/v1/state
  | GET  /api/v1/events (SSE)
  v
tether-web (Go transport adapter)
  | newline-delimited JSON
  v
tetherd Unix socket
  |
  v
BlueZ and the existing Tether modules
```

The three tested seams are:

1. The daemon control protocol over the Unix socket.
2. The gateway's HTTP/SSE interface.
3. Browser-visible workflows.

`tether-web` deliberately treats commands and events as opaque JSON. It owns
reconnection, fan-out, bounded buffering, durable status snapshots, same-origin
checks, and static assets. It must not own Bluetooth policy, interpret pairing
results, or grow feature-specific HTTP routes.

## Browser interface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/commands` | Forward one JSON daemon command |
| `GET` | `/api/v1/events` | Stream daemon events with server-sent events |
| `GET` | `/api/v1/state` | Return the latest durable status events for a newly opened tab |
| `GET` | `/healthz` | Gateway process liveness |
| `GET` | `/readyz` | Gateway is connected to `tetherd` |

Transient events such as passkey confirmation and pairing progress are never
cached. Pairing commands carry an `operation_id`; progress, confirmation, and
results echo it. A browser tab ignores events for operations it did not start.
Legacy clients may omit the identifier.

On subscription, `tetherd` emits `protocol_info` with a protocol version and
coarse capabilities. Clients hide controls for unavailable capability groups
rather than comparing application versions.

## Adding a feature

A feature should normally require changes in these places only:

1. Implement or reuse a daemon command/event in the Unix control protocol.
2. Add the capability to `build_protocol_info()` only when introducing a new
   capability group.
3. Add the command/event shape to `web/ui/src/protocol.ts`.
4. Reduce live events into browser state and build the feature UI.
5. Add a reducer/component test and a browser workflow test using the fake gateway.

Do not add `/api/v1/messages`, `/api/v1/contacts`, or similar gateway routes.
That would duplicate the daemon interface and make GTK, CLI, and web behavior
drift independently. Binary uploads or downloads may receive dedicated HTTP
handling later because they are a transport concern, not domain policy.

Unknown daemon events are ignored by the browser. Existing events remain usable
when a newer daemon advertises additional capabilities.

## Security model

The initial deployment is unauthenticated and intended only for a trusted LAN.
Use HTTPS ingress and restrict port 5135 with the host firewall. The gateway:

- rejects unconfigured `Host` values;
- rejects cross-origin and cross-site mutating requests;
- provides no CORS access;
- accepts commands only as `application/json`;
- limits command bodies to 1 MiB;
- sets a restrictive content security policy and disallows framing; and
- never exposes the daemon's Unix socket.

These controls reduce browser-based attacks and DNS rebinding. They do not stop
another actor already on the trusted LAN. Authentication can later wrap the same
HTTP interface without changing daemon or UI feature semantics.

Numeric comparison is always explicit. No client may automatically approve a
Bluetooth passkey, and a mismatched code must be rejected.
