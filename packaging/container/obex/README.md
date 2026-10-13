# Container OBEX MTU backport

The container supervises `/usr/local/libexec/tether-obexd`, built from the
checksum-pinned Ubuntu `bluez 5.72-0ubuntu5.5` source archives. The build applies
the complete Ubuntu patch series, then only upstream commit
[`99abc8a9e1e1d256749e519a1758bf9a8576c468`](https://github.com/bluez/bluez/commit/99abc8a9e1e1d256749e519a1758bf9a8576c468):
`g_obex_new(io, type, rx_mtu, tx_mtu)` in `obexd/client/session.c`.
No Tether protocol, queue, timeout, or daemon recovery behavior changes.

The source pin is intentional, not a floating `apt source` or Git checkout.
When updating Ubuntu security fixes, update both archive URLs and SHA-256 values
in `build.sh`, review the distro patch series and backport, and rerun the tests.
The base image and build dependencies still use Ubuntu's package repositories;
this pins source inputs, not every toolchain dependency or the complete image.
The stock `bluez-obexd` package remains installed for its distro-managed runtime
dependencies, but its binary is not supervised and its D-Bus activator is removed.
The payload includes source/backport provenance, executable checksum, and license
notices. OBEX's experimental plugins are retained; the phonebook plugin remains
`dummy`, as in Ubuntu's 5.72 build (the distro's old `--enable-phonebook-ebook`
configure flag is no longer recognized by that source).

## Regression

`test-mtu.c` compiles the real, distro-patched `session.c` and links against the
same OBEX/library objects as the daemon. A fake transport supplies asymmetric
L2CAP MTUs: RX **32767**, TX **672**. A constructor interception stops the client
before D-Bus setup, but calls the **real** `g_obex_new`; no constructor, packet
encoder, or OBEX library is mocked. A local `SOCK_SEQPACKET` peer then verifies:

- The actual CONNECT bytes advertise RX 32767, not TX 672.
- After the peer advertises 65535, a full PUT packet is still capped at TX 672.

Every build first runs a negative control on the unpatched Ubuntu source and
requires the specific wrong-RX assertion failure; compiler errors and unrelated
crashes do not count. It then applies the backport, rebuilds, and requires both
wire-level assertions to pass. No phone, adapter, host bus, or daemon is needed.
This demonstrates the constructor defect and its fix, **not** that this defect
caused a particular phone's `Message too long` failure or listing timeouts.

## Run

```sh
docker build --target obex-build -f packaging/container/Dockerfile .
# Or, with a C toolchain, autoconf, automake, libtool, pkg-config, curl,
# patch, xz, and GLib/D-Bus/libical development packages installed:
bash packaging/container/obex/build.sh "$PWD/obex-work" "$PWD/obex-payload"
```

Use a fresh work directory. Only `obexd/src/obexd` is built/installed, never
`bluetoothd`. Container CI runs the regression natively on amd64 and arm64,
builds the runtime, and checks the supervised binary's checksum and provenance
in the existing non-root runtime smoke test. Hardware validation remains separate.
