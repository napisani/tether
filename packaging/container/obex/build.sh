#!/usr/bin/env bash
# Build only OBEX from a pinned Ubuntu source, keeping its complete patch stack.
# Usage: bash build.sh WORK_DIRECTORY PAYLOAD_DIRECTORY
set -euo pipefail
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=${1:?Supply a work directory}
payload=${2:?Supply an absolute payload directory}
[[ $work == /* && $payload == /* ]]
mkdir -p "$work"
cd "$work"
test ! -e bluez-5.72
source_base=https://launchpad.net/ubuntu/+archive/primary/+sourcefiles/bluez/5.72-0ubuntu5.5
curl --fail --location --retry 3 "$source_base/bluez_5.72.orig.tar.xz" -o bluez_5.72.orig.tar.xz
curl --fail --location --retry 3 "$source_base/bluez_5.72-0ubuntu5.5.debian.tar.xz" -o bluez_5.72-0ubuntu5.5.debian.tar.xz
printf '%s\n' \
    '499d7fa345a996c1bb650f5c6749e1d929111fa6ece0be0e98687fee6124536e  bluez_5.72.orig.tar.xz' \
    'cb88d8977950f8fe567e28daf0a5f688ceb866e7cdf366e992d24736454972e5  bluez_5.72-0ubuntu5.5.debian.tar.xz' \
    | sha256sum --check --strict
# Do not unpack anything before both downloads pass checksum verification.
tar -xf bluez_5.72.orig.tar.xz
tar -xf bluez_5.72-0ubuntu5.5.debian.tar.xz -C bluez-5.72
cd bluez-5.72
while read -r name options; do
    case "$name" in ''|'#'*) continue ;; esac
    # This pinned series contains no per-patch options. Fail closed if that changes.
    test -z "$options"
    patch --batch --forward --fuzz=0 -p1 < "debian/patches/$name"
done < debian/patches/series
autoreconf -fi
# Preserve Ubuntu's OBEX plugins, including experimental pcsuite. Its packaging
# passes obsolete --enable-phonebook-ebook; 5.72 actually defaults to dummy.
# Make that existing behavior explicit, and build only the OBEX target below.
export SOURCE_DATE_EPOCH=1704067200
export CFLAGS="-O2 -g -fstack-protector-strong -ffile-prefix-map=$PWD=."
export CPPFLAGS='-D_FORTIFY_SOURCE=2'
export LDFLAGS='-Wl,-z,relro -Wl,-z,now'
./configure --enable-obex --enable-experimental --with-phonebook=dummy \
    --disable-tools --disable-monitor --disable-client \
    --disable-systemd --disable-udev --disable-cups --disable-manpages \
    --disable-mesh --disable-midi --disable-testing --disable-datafiles --disable-library
# Explicit targets do not run Automake's all/BUILT_SOURCES prerequisites.
# Generate BlueZ's own headers rather than accidentally using host libbluetooth.
make -j "${BUILD_JOBS:-4}" obexd/src/builtin.h \
    lib/bluetooth/{bluetooth,hci,hci_lib,sco,l2cap,sdp,sdp_lib,rfcomm,bnep,cmtp,hidp}.h
make -j "${BUILD_JOBS:-4}" obexd/src/obexd
# Negative control: an unpatched real client MUST advertise the wrong RX MTU.
# A compiler error, missing dependency, timeout, or unrelated crash is not a pass.
ulimit -c 0
status=0
bash "$here/test-mtu.sh" > test-unpatched.log 2>&1 || status=$?
cat test-unpatched.log
[[ $status == 134 ]]
grep -Fq '672 == 32767' test-unpatched.log
printf 'PASS: regression rejects the unpatched Ubuntu client\n'
patch --batch --forward --fuzz=0 -p1 < "$here/0001-client-fix-connect-mtu.patch"
make -j "${BUILD_JOBS:-4}" obexd/src/obexd
bash "$here/test-mtu.sh"
obexd/src/obexd --help | grep -q -- '--nodetach'
install -D -m 755 obexd/src/obexd "$payload/libexec/tether-obexd"
install -D -m 644 debian/copyright "$payload/share/doc/tether-obexd/copyright"
mkdir -p "$payload/share/tether"
printf '%s\n' 'Ubuntu source: bluez 5.72-0ubuntu5.5 (complete distro patch stack)' \
    'Backport: 99abc8a9e1e1d256749e519a1758bf9a8576c468' \
    > "$payload/share/tether/obex-build.txt"
hash=$(sha256sum "$payload/libexec/tether-obexd")
printf '%s  /usr/local/libexec/tether-obexd\n' "${hash%% *}" \
    > "$payload/share/tether/obexd.sha256"
