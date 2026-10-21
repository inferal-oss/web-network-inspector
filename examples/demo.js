import {
  activityInsight,
  insightSorter,
  insightStyles,
} from "./insight-column.js";
import {
  createInspector,
  createPersistentCapture,
  defaultColumns,
  code,
} from "../src/index.js";
const store = await createPersistentCapture({
  storage: (await import("../src/storage.js")).createIndexedDBStorage({
    database: "web-network-inspector-demo",
  }),
});
const inspector = createInspector({
  store,
  open: true,
  resourcePreviews: "on-select",
  renderDetails(context) {
    context.renderDefault();
    syncDetailsDisplay(context.document);
  },
});
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
  "border:1px solid #cdd9ee;border-radius:20px;padding:4px 9px;color:#2456ac;background:#edf3ff;font:var(--text-10) ui-monospace,monospace;white-space:nowrap";
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
          "color:#21715e;font:600 var(--text-10) ui-monospace,monospace;letter-spacing:.06em";
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

// The same Open Regard controller powers the site header and this custom bar item.
if (window.inferalDisplay && window.mountInferalDisplay) {
  for (const file of ["widget.css", "display.css"]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL(`./display/${file}`, import.meta.url).href;
    inspector.root.append(link);
  }
  const display = window.inferalDisplay;
  const container = document.createElement("div");
  inspector.addBarItem({ id: "openregard-display", element: container });
  const widget = window.mountInferalDisplay(container);
  let previous = display.getSnapshot();
  function apply() {
    const profile = display.getSnapshot();
    const scale = profile === "standard" ? 1 : 1.25;
    for (const size of [10, 11, 12, 13, 14, 21, 22])
      inspector.host.style.setProperty(`--text-${size}`, `${size * scale}px`);
    for (const [key, value] of Object.entries(
      profile === "clarity" || profile === "contrast"
        ? {
            "--panel": "#fff",
            "--paper": "#f5f7fa",
            "--ink": profile === "contrast" ? "#000" : "#101a2b",
            "--muted": "#222",
            "--line": "#6b7280",
            "--brand": "#0645ad",
            "--brand-dark": "#003584",
            "--brand-soft": "#e5eeff",
          }
        : {},
    ))
      inspector.host.style.setProperty(key, value);
    if (profile === "standard" || profile === "vision")
      for (const key of [
        "--panel",
        "--paper",
        "--ink",
        "--muted",
        "--line",
        "--brand",
        "--brand-dark",
        "--brand-soft",
      ])
        inspector.host.style.removeProperty(key);
    const frame = inspector.root.querySelector(".network-detail-frame");
    if (frame?.contentDocument?.documentElement)
      syncDetailsDisplay(frame.contentDocument);
    if (profile !== previous) {
      inspector.recordEvent({
        type: "display.changed",
        label: `Display · ${display.config.profiles.find((p) => p.id === profile).label}`,
        data: JSON.stringify({ profile, previous, source: "openregard" }),
        parentId: null,
      });
      previous = profile;
    }
  }
  const off = display.subscribe(apply);
  apply();
  window.addEventListener(
    "pagehide",
    () => {
      off();
      widget.destroy();
    },
    { once: true },
  );
}

function syncDetailsDisplay(document) {
  const style = getComputedStyle(inspector.host);
  for (const key of [
    "--panel",
    "--paper",
    "--ink",
    "--muted",
    "--line",
    "--brand",
    "--brand-dark",
    "--brand-soft",
    ...[10, 11, 12, 13, 14, 21, 22].map((size) => `--text-${size}`),
  ])
    document.documentElement.style.setProperty(
      key,
      style.getPropertyValue(key),
    );
}

// Every visible column, including defaults, is supplied through the public API.
const insightStyle = document.createElement("style");
insightStyle.textContent = insightStyles;
inspector.root.append(insightStyle);
const insightColumn = {
  id: "insight",
  label: "Activity Insight",
  width: 190,
  minWidth: 140,
  render: activityInsight,
  sort: insightSorter,
};
const definitions = [
  ...defaultColumns.slice(0, -1),
  insightColumn,
  defaultColumns.at(-1),
];
const enabled = new Set(defaultColumns.map((column) => column.id));
const widths = new Map();
const choices = document.getElementById("column-choices");
const controls = new Map();
const columnsButton = document.getElementById("columns-toggle");
function applyColumns() {
  for (const column of inspector.getColumns())
    widths.set(column.id, { width: column.width, flex: column.flex });
  const showInsight = enabled.has("insight");
  inspector.setColumns(
    definitions
      .filter((column) => enabled.has(column.id))
      .map((column) => ({
        ...column,
        ...widths.get(column.id),
        sort:
          (column.id === "size" &&
            !document.getElementById("column-sort-size").checked) ||
          (column.id === "insight" &&
            !document.getElementById("column-sort-insight").checked)
            ? false
            : column.sort,
        render:
          column.id === "code" && showInsight
            ? (entry, context) => {
                code(entry, context);
                context.container.style.color =
                  Number(context.container.textContent) >= 400 ? "#a12235" : "";
              }
            : column.render,
      })),
  );
  for (const [id, input] of controls) {
    input.checked = enabled.has(id);
    input.disabled = enabled.size === 1 && input.checked;
  }
  columnsButton.disabled = showInsight && enabled.size === 1;
  columnsButton.setAttribute("aria-pressed", String(showInsight));
  columnsButton.textContent = showInsight
    ? "Hide Activity Insight"
    : "Try custom columns";
  document.getElementById("columns-result").textContent = showInsight
    ? "Activity Insight shows latency, payload sizes, message direction, and event correlation. Click its header to sort by recorded duration."
    : enabled.size +
      " columns visible. Resize, hide, or sort them to suit your workflow.";
}
for (const column of definitions) {
  const label = document.createElement("label"),
    input = document.createElement("input");
  input.type = "checkbox";
  input.checked = enabled.has(column.id);
  input.dataset.columnChoice = column.id;
  input.addEventListener("change", () => {
    if (input.checked) enabled.add(column.id);
    else enabled.delete(column.id);
    applyColumns();
  });
  label.append(input, column.label);
  choices.append(label);
  controls.set(column.id, input);
}
columnsButton.addEventListener("click", () => {
  if (enabled.has("insight")) enabled.delete("insight");
  else enabled.add("insight");
  applyColumns();
});
document.getElementById("columns-reset").addEventListener("click", () => {
  enabled.clear();
  for (const column of defaultColumns) enabled.add(column.id);
  widths.clear();
  inspector.setColumns(defaultColumns);
  document.getElementById("column-sort-size").checked = true;
  document.getElementById("column-sort-insight").checked = true;
  applyColumns();
});
for (const id of ["column-sort-size", "column-sort-insight"])
  document.getElementById(id).addEventListener("change", applyColumns);
