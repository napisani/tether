#!/usr/bin/env bash
# Run in a configured, built BlueZ source tree; no Bluetooth hardware or bus.
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
objects=(btio/obexd-*.o gobex/obexd-*.o obexd/{src,client,plugins}/obexd-*.o)
linked=()
for object in "${objects[@]}"; do
    [[ $object == obexd/client/obexd-session.o ]] || linked+=("$object")
done
# pkg-config intentionally supplies separate compiler/linker arguments.
cflags_text=$(pkg-config --cflags glib-2.0 dbus-1 libical)
libs_text=$(pkg-config --libs glib-2.0 dbus-1 libical)
read -r -a cflags <<< "$cflags_text"
read -r -a libs <<< "$libs_text"
"${CC:-cc}" -DHAVE_CONFIG_H -I. -Ilib -Iobexd/src "${cflags[@]}" \
    "$here/test-mtu.c" "${linked[@]}" \
    lib/.libs/libbluetooth-internal.a gdbus/.libs/libgdbus-internal.a \
    src/.libs/libshared-glib.a "${libs[@]}" -ldl -Wl,--wrap=main -o test-obex-mtu
./test-obex-mtu
