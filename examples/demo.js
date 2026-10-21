import { createInspector } from "../src/index.js";
const inspector = createInspector({ open: true });
let count = 0;
inspector.addBarItem({
  id: "connection",
  label: "Connection · ready",
  title: "Inspect example connection",
  onClick: ({ element }) => {
    inspector.openPopup({
      title: "Example connection",
      anchor: element,
      content: ({ container, close }) => {
        const text = document.createElement("p");
        text.textContent =
          "This is application-owned content. The inspector does not assume a backend protocol.";
        const button = document.createElement("button");
        button.textContent = "Record a check";
        button.addEventListener("click", () => {
          inspector.recordEvent({
            type: "connection.check",
            label: "Checked example connection",
            data: "Connection is ready",
          });
          close();
        });
        container.append(text, button);
      },
    });
  },
});
const result = document.getElementById("result");
document.getElementById("request").addEventListener("click", async () => {
  inspector.recordEvent({
    type: "request.clicked",
    label: "Fetch example JSON",
  });
  try {
    const response = await fetch("/echo");
    const data = await response.json();
    result.textContent = data.message;
  } catch (error) {
    result.textContent = error.message;
  }
});
document.getElementById("event").addEventListener("click", () => {
  inspector.recordEvent({
    type: "counter.changed",
    label: `Example count ${++count}`,
    correlationId: "demo-counter",
    data: JSON.stringify({ count }),
  });
  result.textContent = `Recorded event ${count}`;
});
// Explicitly expose this demo instance for the browser examples and tests.
window.inspector = inspector;
