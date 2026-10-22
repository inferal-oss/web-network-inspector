import { themeStyles } from "./themes.js";
import { renderDemoDetails } from "./detail-renderer.js";
import {
  activityInsight,
  insightSorter,
  insightStyles,
} from "./insight-column.js";
import {
  createPersistentInspector,
  createWebStorage,
  createPersistentCapture,
  defaultColumns,
  code,
} from "../src/index.js";
const store = await createPersistentCapture({
  storage: (await import("../src/storage.js")).createIndexedDBStorage({
    database: "web-network-inspector-demo",
  }),
});
const insightColumn = {
  id: "insight",
  label: "Activity Insight",
  width: 190,
  minWidth: 140,
  render: activityInsight,
  sort: insightSorter,
  hidden: true,
};
const definitions = [
  ...defaultColumns.slice(0, -1),
  insightColumn,
  defaultColumns.at(-1),
].map((column) =>
  column.id === "code"
    ? {
        ...column,
        render(entry, context) {
          code(entry, context);
          context.container.style.color =
            Number(context.container.textContent) >= 400
              ? "var(--demo-error, #a12235)"
              : "";
        },
      }
    : column,
);
let customDetailsEnabled = true;
try {
  customDetailsEnabled =
    localStorage.getItem("web-network-inspector-demo:custom-details") !== "off";
} catch {}
function renderDetails(context) {
  syncDetailsDisplay(context.document);
  if (customDetailsEnabled) return renderDemoDetails(context);
  context.renderDefault();
}
const inspector = await createPersistentInspector({
  columns: definitions,
  storage: createWebStorage({ key: "web-network-inspector-demo:view-v1" }),
  store,
  open: true,
  resourcePreviews: "on-select",
  renderDetails,
});
window.addEventListener("pagehide", () => {
  void store.persistence.flush().catch(() => {});
});
let count = 0;
let environment = "Sandbox";

// A native select: the inspector accepts application-owned DOM elements.
const environmentControl = document.createElement("label");
environmentControl.style.cssText =
  "display:flex;align-items:center;gap:6px;white-space:nowrap;color:var(--muted)";
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
  "border:1px solid var(--line);border-radius:20px;padding:4px 9px;color:var(--brand-dark);background:var(--brand-soft);font:var(--text-10) ui-monospace,monospace;white-space:nowrap";
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
          "color:var(--demo-green,#21715e);font:600 var(--text-10) ui-monospace,monospace;letter-spacing:.06em";
        const text = document.createElement("p");
        text.textContent = `Environment: ${environment}. This popup is supplied by the application, using the inspector's public extension API.`;
        text.style.cssText = "color:var(--muted);line-height:1.7";
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
    applyDemoTheme(false);
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
  queueMicrotask(apply);
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
  const computed = getComputedStyle(inspector.host);
  const html = document.documentElement;
  for (const key of Array.from(html.style))
    if (key.startsWith("--")) html.style.removeProperty(key);
  for (let i = 0; i < computed.length; i++) {
    const key = computed[i];
    if (key.startsWith("--"))
      html.style.setProperty(key, computed.getPropertyValue(key));
  }
  html.dataset.demoEffective =
    inspector.host.dataset.demoEffective || "default";
  html.style.colorScheme = computed.colorScheme;
  if (!document.getElementById("demo-theme-styles")) {
    const style = document.createElement("style");
    style.id = "demo-theme-styles";
    style.textContent = themeStyles;
    document.head.append(style);
  }
}

// Every visible column, including defaults, is supplied through the public API.
const insightStyle = document.createElement("style");
insightStyle.textContent = insightStyles;
inspector.root.append(insightStyle);
const choices = document.getElementById("column-choices");
const controls = new Map();
const columnsButton = document.getElementById("columns-toggle");
function syncColumnControls() {
  const columns = inspector.getColumns();
  const visible = columns.filter((column) => !column.hidden);
  const insight = columns.find((column) => column.id === "insight");
  const showInsight = insight && !insight.hidden;
  for (const [id, input] of controls) {
    const column = columns.find((column) => column.id === id);
    input.checked = Boolean(column && !column.hidden);
    input.disabled = visible.length === 1 && input.checked;
  }
  for (const id of ["size", "insight"])
    document.getElementById("column-sort-" + id).checked =
      typeof columns.find((column) => column.id === id)?.sort === "function";
  columnsButton.disabled = showInsight && visible.length === 1;
  columnsButton.setAttribute("aria-pressed", String(Boolean(showInsight)));
  columnsButton.textContent = showInsight
    ? "Hide Activity Insight"
    : "Try custom columns";
  document.getElementById("columns-result").textContent = showInsight
    ? "Activity Insight shows latency, payload sizes, message direction, and event correlation. Your layout and sorting are remembered across reloads."
    : visible.length +
      " columns visible. Layout and sorting are remembered across reloads.";
}
function applyColumns() {
  const current = new Map(
    inspector.getColumns().map((column) => [column.id, column]),
  );
  inspector.setColumns(
    definitions.map((column) => ({
      ...column,
      ...current.get(column.id),
      hidden: !controls.get(column.id).checked,
      sort:
        column.id === "size" || column.id === "insight"
          ? document.getElementById("column-sort-" + column.id).checked
            ? column.sort
            : false
          : column.sort,
      render:
        column.id === "code" && controls.get("insight").checked
          ? (entry, context) => {
              code(entry, context);
              context.container.style.color =
                Number(context.container.textContent) >= 400
                  ? "var(--demo-error, #a12235)"
                  : "";
            }
          : column.render,
    })),
  );
}
for (const column of definitions) {
  const label = document.createElement("label"),
    input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.columnChoice = column.id;
  input.addEventListener("change", applyColumns);
  label.append(input, column.label);
  choices.append(label);
  controls.set(column.id, input);
}
columnsButton.addEventListener("click", () => {
  controls.get("insight").checked = !controls.get("insight").checked;
  applyColumns();
});
document
  .getElementById("columns-reset")
  .addEventListener("click", () => inspector.setColumns(definitions));
for (const id of ["column-sort-size", "column-sort-insight"])
  document.getElementById(id).addEventListener("change", applyColumns);
const offView = inspector.subscribeView(syncColumnControls);
syncColumnControls();
window.addEventListener("pagehide", offView, { once: true });

// The same theme rules apply in the shadow root and details document.
const themeStyle = document.createElement("style");
themeStyle.textContent = themeStyles;
inspector.root.append(themeStyle);
const themeToggle = document.getElementById("theme-toggle");
const darkToggle = document.getElementById("theme-dark");
const customView = document.getElementById("details-toggle");
customView.checked = customDetailsEnabled;
function applyDemoTheme(save = true) {
  const choice = darkToggle.checked
    ? "dark"
    : themeToggle.checked
      ? "plum"
      : "default";
  const profile = window.inferalDisplay?.getSnapshot();
  const effective = ["clarity", "contrast"].includes(profile)
    ? "default"
    : choice;
  inspector.host.dataset.demoTheme = choice;
  inspector.host.dataset.demoEffective = effective;
  inspector.host.style.colorScheme = effective === "dark" ? "dark" : "light";
  document.getElementById("theme-result").textContent =
    (choice === "dark"
      ? "Midnight dark theme"
      : choice === "plum"
        ? "Plum theme"
        : "Default inspector styling") +
    (effective !== choice
      ? " · display contrast takes precedence"
      : " · includes previews and custom columns");
  const frame = inspector.root.querySelector(".network-detail-frame");
  if (frame?.contentDocument?.documentElement)
    syncDetailsDisplay(frame.contentDocument);
  inspector.setDetailsRenderer(renderDetails);
  if (save)
    try {
      localStorage.setItem("web-network-inspector-demo:theme", choice);
    } catch {}
}
function syncCustomView() {
  customDetailsEnabled = customView.checked;
  inspector.setDetailsRenderer(renderDetails);
  document.getElementById("details-result").textContent = customDetailsEnabled
    ? "Custom summary + default headers and body previews"
    : "Default details renderer · custom summary off";
  try {
    localStorage.setItem(
      "web-network-inspector-demo:custom-details",
      customDetailsEnabled ? "on" : "off",
    );
  } catch {}
}
try {
  const choice = localStorage.getItem("web-network-inspector-demo:theme");
  themeToggle.checked = choice === "plum";
  darkToggle.checked = choice === "dark";
} catch {}
themeToggle.addEventListener("change", () => {
  if (themeToggle.checked) darkToggle.checked = false;
  applyDemoTheme();
});
darkToggle.addEventListener("change", () => {
  if (darkToggle.checked) themeToggle.checked = false;
  applyDemoTheme();
});
customView.addEventListener("change", syncCustomView);
syncCustomView();
applyDemoTheme(false);

// Native change events stay inside a shadow root, so listen on both surfaces.
function recordCheckbox(event) {
  const input = event.target;
  if (!input.matches?.('input[type="checkbox"]')) return;
  const rawLabel =
    input.getAttribute("aria-label") ||
    input.labels?.[0]?.textContent.trim() ||
    input.id ||
    "Checkbox";
  const label = rawLabel.replace(/\s+/g, " ").trim();
  inspector.recordEvent({
    type: "demo.checkbox.changed",
    label: label + (input.checked ? " · on" : " · off"),
    correlationId: "demo-settings",
    data: JSON.stringify({
      control: input.id || input.dataset.columnChoice || label,
      label,
      checked: input.checked,
      source: input.getRootNode() === inspector.root ? "inspector" : "page",
      environment,
    }),
    parentId: null,
  });
}
document.addEventListener("change", recordCheckbox);
inspector.root.addEventListener("change", recordCheckbox);
window.addEventListener(
  "pagehide",
  () => {
    document.removeEventListener("change", recordCheckbox);
    inspector.root.removeEventListener("change", recordCheckbox);
  },
  { once: true },
);

// A span is retained once; finishing updates that row instead of adding a point.
const spanStart = document.getElementById("span-start");
const spanFinish = document.getElementById("span-finish");
const spanRun = document.getElementById("span-run");
const spanResult = document.getElementById("span-result");
let demoSpan = null,
  spanTimer = null,
  spanTick = null,
  spanStarted = 0;
function finishDemoSpan() {
  if (!demoSpan) return;
  const entry = demoSpan.finish({
    data: JSON.stringify({ environment, result: "Report ready", rows: 42 }),
  });
  clearTimeout(spanTimer);
  clearInterval(spanTick);
  demoSpan = null;
  spanStart.disabled = spanRun.disabled = false;
  spanFinish.disabled = true;
  spanResult.textContent = entry
    ? `Complete · ${(entry.end - entry.start).toFixed(0)} ms · inspect Build report span`
    : "The span is no longer retained. Start another to try again.";
}
function startDemoSpan(timed) {
  if (demoSpan) return;
  demoSpan = inspector.startEvent({
    type: "demo.report",
    label: "Build report span",
    correlationId: "demo-report",
    parentId: null,
    data: JSON.stringify({ environment, mode: timed ? "timed" : "manual" }),
  });
  if (!demoSpan) {
    spanResult.textContent =
      "Recording paused · resume capture to start a span";
    return;
  }
  spanStarted = performance.now();
  spanStart.disabled = spanRun.disabled = true;
  spanFinish.disabled = false;
  const update = () => {
    spanResult.textContent = `Running · ${((performance.now() - spanStarted) / 1000).toFixed(1)} s · finish to keep the measured duration`;
  };
  update();
  spanTick = setInterval(update, 100);
  if (timed) spanTimer = setTimeout(finishDemoSpan, 3000);
}
spanStart.addEventListener("click", () => startDemoSpan(false));
spanRun.addEventListener("click", () => startDemoSpan(true));
spanFinish.addEventListener("click", finishDemoSpan);
window.addEventListener(
  "pagehide",
  () => {
    clearTimeout(spanTimer);
    clearInterval(spanTick);
  },
  { once: true },
);
