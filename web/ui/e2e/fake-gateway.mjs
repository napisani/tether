import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../cmd/tether-web/dist", import.meta.url));
const clients = new Set();
const phone = {
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

const durable = {
  protocol_info: {
    command: "protocol_info",
    version: 1,
    capabilities: ["bluetooth.connection", "bluetooth.pairing"],
  },
  bt_status: {
    command: "bt_status",
    available: true,
    enabled: true,
    device_address: "",
    version: "0.2.32-e2e",
  },
  bt_devices: { command: "bt_devices", devices: [] },
  bt_connection_changed: {
    command: "bt_connection_changed",
    device_present: false,
    device_paired: false,
    classic_connected: false,
    le_available: false,
    le_connected: false,
    map_open: false,
    pbap_open: false,
    ancs_ready: false,
  },
};

function reset() {
  Object.assign(phone, {
    name: "40-F6-64-3D-7A-F1",
    iphone: false,
    paired: false,
    bonded: false,
    trusted: false,
    connected: false,
    classic_connected: false,
    le_bonded: false,
    le_connected: false,
    map: false,
    pbap: false,
    ancs: false,
    ancs_notifying: false,
  });
  durable.bt_status.device_address = "";
  durable.bt_devices = { command: "bt_devices", devices: [] };
  durable.bt_connection_changed = {
    command: "bt_connection_changed",
    device_present: false,
    device_paired: false,
    classic_connected: false,
    le_available: false,
    le_connected: false,
    map_open: false,
    pbap_open: false,
    ancs_ready: false,
  };
}

function publish(event) {
  if (Object.hasOwn(durable, event.command)) durable[event.command] = event;
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of clients) response.write(frame);
}

function handleCommand(command) {
  if (command.command === "bt_scan") {
    setTimeout(() => publish({ command: "bt_devices", devices: [phone] }), 20);
    setTimeout(() => {
      publish({ command: "bt_scan_result", success: true, message: "Bluetooth scan finished." });
      publish({ command: "bt_devices", devices: [] });
    }, 40);
  }
  if (command.command === "bt_pair") {
    setTimeout(() => {
      publish({
        command: "bt_pair_progress",
        operation_id: command.operation_id,
        step: "pair",
        detail: "Waiting for the iPhone",
      });
      publish({
        command: "bt_pair_confirm_request",
        operation_id: command.operation_id,
        code: "042731",
      });
    }, 20);
  }
  if (command.command === "bt_pair_confirm" && command.accept) {
    setTimeout(() => {
      Object.assign(phone, {
        name: "Nick’s iPhone",
        iphone: true,
        paired: true,
        bonded: true,
        trusted: true,
        connected: true,
        classic_connected: true,
        le_bonded: true,
        le_connected: true,
        map: true,
        pbap: true,
        ancs: true,
        ancs_notifying: true,
      });
      publish({
        command: "bt_pair_result",
        operation_id: command.operation_id,
        success: true,
        status: "paired",
        message: "Paired with Nick’s iPhone.",
        dual_bond: true,
      });
      publish({ command: "bt_devices", devices: [phone] });
      publish({
        command: "bt_connection_changed",
        device_present: true,
        device_paired: true,
        classic_connected: true,
        le_available: true,
        le_connected: true,
        map_open: true,
        pbap_open: true,
        ancs_ready: true,
      });
    }, 20);
  }
}

const server = createServer((request, response) => {
  if (request.url === "/api/v1/state") {
    reset();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ daemon_connected: true, events: durable }));
    return;
  }
  if (request.url === "/api/v1/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(": connected\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (request.url === "/api/v1/commands" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      handleCommand(JSON.parse(body));
      response.writeHead(202).end();
    });
    return;
  }

  const requested = request.url === "/" ? "index.html" : request.url.slice(1);
  let path = join(dist, requested);
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(dist, "index.html");
  const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  response.writeHead(200, { "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(response);
});

server.listen(4173, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
