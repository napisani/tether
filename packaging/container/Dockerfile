# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS web-ui
WORKDIR /src/web/ui
COPY web/ui/package.json web/ui/package-lock.json ./
RUN npm ci
COPY web/ui/ ./
RUN npm test && npm run build

FROM golang:1.26-bookworm AS web-build
WORKDIR /src/web
COPY web/go.mod ./
COPY web/internal/ ./internal/
COPY web/cmd/ ./cmd/
COPY --from=web-ui /src/web/cmd/tether-web/dist/ ./cmd/tether-web/dist/
RUN CGO_ENABLED=0 go test ./... \
    && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /tether-web ./cmd/tether-web

FROM ubuntu:24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake ninja-build git pkg-config ca-certificates \
    libwayland-dev libavahi-client-dev libssl-dev libglib2.0-dev libsecret-1-dev \
    libgtk-3-dev libgtk-layer-shell-dev libnotify-dev gettext dbus-daemon \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
ARG TETHER_VERSION=0.2.32-container-dev
ARG BUILD_JOBS=4
RUN cmake -S . -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/usr/local -DTETHER_VERSION="${TETHER_VERSION}" \
      -DTETHER_BUILD_EXTENSIONS=OFF \
    && cmake --build /build --target tetherd tether_cli translations -j "${BUILD_JOBS}" \
    && mkdir -p /payload/bin /payload/share/locale \
    && install -m 755 /build/tether /build/tetherd /payload/bin/ \
    && cp -a /build/locale/. /payload/share/locale/

FROM build AS test
RUN cmake --build /build --target tether_test tether_headless_test tether_container_store_fixture -j "${BUILD_JOBS}"
WORKDIR /build
# Run tests as non-root too; permission failures must not be hidden by root.
RUN chmod -R a+rX /src /build && mkdir -p /test-home /build/Testing \
    && chown -R 1000:1000 /test-home /build/Testing
ENV HOME=/test-home
USER 1000:1000
RUN ctest --output-on-failure -j 4

FROM ubuntu:24.04 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash coreutils tini dbus-daemon dbus-bin libglib2.0-bin bluez-obexd \
    libwayland-client0 libavahi-client3 libssl3t64 libglib2.0-0t64 libsecret-1-0 libnotify4 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/libexec /data /downloads /run/tether-runtime \
    && obexd="$(dpkg -L bluez-obexd | grep '/obexd$')" \
    && test -x "$obexd" && "$obexd" --help | grep -q -- '--nodetach' \
    && ln -s "$obexd" /usr/local/libexec/tether-obexd \
    # OBEX is explicitly supervised, never silently respawned by D-Bus activation.
    && rm /usr/share/dbus-1/services/org.bluez.obex.service \
    && chown 1000:1000 /data /downloads /run/tether-runtime \
    && chmod 700 /data /downloads /run/tether-runtime
COPY --from=build /payload/ /usr/local/
COPY --from=web-build /tether-web /usr/local/bin/tether-web
COPY --chmod=755 packaging/container/entrypoint.sh /usr/local/libexec/tether-container-entrypoint
COPY --chmod=755 packaging/container/healthcheck.sh /usr/local/libexec/tether-container-healthcheck
RUN ldd /usr/local/bin/tether /usr/local/bin/tetherd > /tmp/linked-libraries \
    && ! grep -q 'not found' /tmp/linked-libraries && rm /tmp/linked-libraries
ENV HOME=/data \
    XDG_CONFIG_HOME=/data/.config \
    XDG_DATA_HOME=/data/.local/share \
    XDG_STATE_HOME=/data/.local/state \
    XDG_DOWNLOAD_DIR=/downloads \
    XDG_RUNTIME_DIR=/run/tether-runtime \
    XDG_CACHE_HOME=/run/tether-runtime/cache \
    DBUS_SYSTEM_BUS_ADDRESS=unix:path=/host/run/dbus/system_bus_socket \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/tether-runtime/bus \
    TETHER_LOG_STDERR=1 \
    TETHER_NO_AUTOSTART=1 \
    TETHER_WEB_ENABLED=1 \
    TETHER_WEB_LISTEN=0.0.0.0:5135 \
    TETHER_WEB_ALLOWED_HOSTS=localhost
USER 1000:1000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 \
    CMD ["/usr/local/libexec/tether-container-healthcheck"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/libexec/tether-container-entrypoint"]
CMD ["tetherd"]
