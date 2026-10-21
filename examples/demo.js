import { createInspector, createPersistentCapture } from "../src/index.js";
const store = await createPersistentCapture({
  storage: (await import("../src/storage.js")).createIndexedDBStorage({
    database: "web-network-inspector-demo",
  }),
});
const inspector = createInspector({ store, open: true });
window.addEventListener("pagehide", () => {
  void store.persistence.flush().catch(() => {});
});
let count = 0;
let environment = "Sandbox";

// A native select: the inspector accepts application-owned DOM elements.
const environmentControl = document.createElement("label");
environmentControl.style.cssText =
  "display:flex;align-items:center;gap:6px;white-space:nowrap;color:#566477";
environmentControl.append("Environment");
const environmentSelect = document.createElement("select");
environmentSelect.setAttribute("aria-label", "Demo environment");
for (const name of ["Sandbox", "Preview", "Local"]) {
  const option = document.createElement("option");
  option.textContent = name;
  environmentSelect.append(option);
}
environmentControl.append(environmentSelect);
inspector.addBarItem({ id: "environment", element: environmentControl });
environmentSelect.addEventListener("change", () => {
  environment = environmentSelect.value;
  inspector.recordEvent({
    type: "environment.changed",
    label: `Switched to ${environment}`,
    correlationId: "demo-settings",
    data: JSON.stringify({ environment, source: "inspector-bar" }),
    parentId: null,
  });
});

// A custom live status element subscribes to the same retained event store.
const counter = document.createElement("span");
counter.setAttribute("aria-live", "polite");
counter.style.cssText =
  "border:1px solid #cdd9ee;border-radius:20px;padding:4px 9px;color:#2456ac;background:#edf3ff;font:10px ui-monospace,monospace;white-space:nowrap";
inspector.addBarItem({ id: "event-count", element: counter });
const updateCounter = () => {
  const events = inspector.store.entries.filter(
    (entry) => entry.kind === "event",
  ).length;
  counter.textContent = `${events} app event${events === 1 ? "" : "s"}`;
};
const unsubscribe = inspector.subscribe(updateCounter);
updateCounter();
window.addEventListener("pagehide", unsubscribe, { once: true });

inspector.addBarItem({
  id: "connection",
  label: "Connection · ready",
  title: "Inspect example connection",
  onClick: ({ element }) => {
    inspector.openPopup({
      title: "Example connection",
      anchor: element,
      content: ({ container, close }) => {
        const badge = document.createElement("p");
        badge.textContent = "● CONNECTED · LOCAL EXAMPLE";
        badge.style.cssText =
          "color:#21715e;font:600 10px ui-monospace,monospace;letter-spacing:.06em";
        const text = document.createElement("p");
        text.textContent = `Environment: ${environment}. This popup is supplied by the application, using the inspector's public extension API.`;
        text.style.cssText = "color:#65738b;line-height:1.7";
        const button = document.createElement("button");
        button.textContent = "Record a check";
        button.addEventListener("click", () => {
          inspector.recordEvent({
            type: "connection.check",
            label: "Checked example connection",
            correlationId: "demo-connection",
            data: JSON.stringify({
              environment,
              status: "ready",
              source: "popup-button",
            }),
            parentId: null,
          });
          close();
        });
        container.append(badge, text, button);
      },
    });
  },
});
const result = document.getElementById("result");
document.getElementById("request").addEventListener("click", async () => {
  inspector.recordEvent({
    type: "request.clicked",
    label: "Fetch example JSON",
    data: JSON.stringify({ environment, source: "page-button" }),
    parentId: null,
  });
  const button = document.getElementById("request");
  button.disabled = true;
  result.textContent = "Sending request…";
  try {
    let data,
      source = "httpbin.org";
    try {
      const response = await fetch("https://httpbin.org/anything", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environment,
          message: "Hello from a synthetic response",
          items: [
            { id: 1, name: "Blue" },
            { id: 2, name: "Green" },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("httpbin is unavailable");
      data = (await response.json()).json;
      if (!Array.isArray(data?.items))
        throw new Error("Unexpected httpbin response");
    } catch {
      source = "Bundled sample · httpbin unavailable";
      const response = await fetch(new URL("./sample.json", import.meta.url));
      if (!response.ok)
        throw new Error("The bundled sample could not be loaded");
      data = await response.json();
    }
    result.textContent = `200 OK · ${data.items.length} items · ${source}`;
  } catch (error) {
    result.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.getElementById("event").addEventListener("click", () => {
  const label =
    document.getElementById("event-label").value.trim() || "Application event";
  const level = document.getElementById("event-level").value;
  const entry = inspector.recordEvent({
    type: "demo.note",
    label,
    correlationId: "demo-session",
    data: JSON.stringify({
      label,
      level,
      environment,
      sequence: ++count,
      source: "page-button",
    }),
    parentId: null,
  });
  document.getElementById("event-result").textContent = entry
    ? `Recorded #${count} · ${level} · ${environment}`
    : "Recording paused · resume in the inspector to capture events";
});
// Explicitly expose this demo instance for the browser examples and tests.
window.inspector = inspector;

// A public echo endpoint: only connect or transmit after an explicit user action.
const socketResult = document.getElementById("socket-result");
const socketConnect = document.getElementById("socket-connect");
const socketSend = document.getElementById("socket-send");
const socketDisconnect = document.getElementById("socket-disconnect");
let demoSocket = null;
let socketTimer;
socketConnect.addEventListener("click", () => {
  socketConnect.disabled = true;
  socketDisconnect.disabled = false;
  socketResult.textContent = "Connecting to Postman echo…";
  inspector.recordEvent({
    type: "socket.connect.clicked",
    label: "Connect WebSocket",
    parentId: null,
  });
  let socket;
  try {
    socket = new WebSocket("wss://ws.postman-echo.com/raw");
  } catch {
    socketResult.textContent =
      "The public echo service is unavailable. Try connecting again.";
    socketConnect.disabled = false;
    socketDisconnect.disabled = true;
    return;
  }
  demoSocket = socket;
  let failed = false;
  const current = () => demoSocket === socket;
  socketTimer = setTimeout(() => {
    if (!current() || socket.readyState !== WebSocket.CONNECTING) return;
    failed = true;
    socketResult.textContent =
      "The public echo service timed out. Try connecting again.";
    socket.close();
  }, 10000);
  socket.addEventListener("open", () => {
    if (!current()) return;
    clearTimeout(socketTimer);
    socketSend.disabled = false;
    socketResult.textContent =
      "Connected · send a sample message to see both frames.";
  });
  socket.addEventListener("message", (event) => {
    if (!current()) return;
    inspector.annotateMessage(socket, "in", {
      type: "demo.echo",
      label: "Echoed WebSocket message",
      correlationId: "demo-echo",
    });
    socketResult.textContent = `Echo received · ${String(event.data).length} characters · inspect the received frame below.`;
  });
  socket.addEventListener("error", () => {
    if (!current()) return;
    failed = true;
    socketResult.textContent =
      "The public echo service is unavailable. Try connecting again.";
  });
  socket.addEventListener("close", () => {
    if (!current()) return;
    clearTimeout(socketTimer);
    demoSocket = null;
    socketConnect.disabled = false;
    socketSend.disabled = true;
    socketDisconnect.disabled = true;
    if (!failed)
      socketResult.textContent =
        "Disconnected · connect again to start another exchange.";
  });
});
socketSend.addEventListener("click", () => {
  if (!demoSocket || demoSocket.readyState !== WebSocket.OPEN) return;
  try {
    demoSocket.send(document.getElementById("socket-message").value);
    inspector.annotateMessage(demoSocket, "out", {
      type: "demo.echo",
      label: "Sent WebSocket message",
      correlationId: "demo-echo",
    });
    socketResult.textContent = "Message sent · waiting for its echo…";
  } catch {
    socketResult.textContent =
      "Message could not be sent. Disconnect and try again.";
  }
});
socketDisconnect.addEventListener("click", () => {
  clearTimeout(socketTimer);
  socketSend.disabled = true;
  demoSocket?.close(1000, "Demo complete");
});
window.addEventListener(
  "pagehide",
  () => {
    clearTimeout(socketTimer);
    demoSocket?.close(1000, "Page closed");
  },
  { once: true },
);
