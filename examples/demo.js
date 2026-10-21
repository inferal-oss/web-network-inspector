import { createInspector } from "../src/index.js";
const inspector = createInspector({ open: true });
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
    const response = await fetch("/echo");
    const data = await response.json();
    result.textContent = `${response.status} OK · ${data.items.length} items · ${data.message}`;
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
