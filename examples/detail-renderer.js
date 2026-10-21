const styles = `
.demo-detail-card { margin: 0 0 14px; padding: 12px 14px; border: 1px solid var(--line,#c5d5f5); border-left: 3px solid var(--brand, #2463cb); border-radius: 8px; background: var(--brand-soft, #e9f1ff); color: var(--ink, #202938); font-family: var(--sans, system-ui, sans-serif); }
.demo-detail-card header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.demo-detail-card .demo-detail-kicker { font-size: var(--text-10,10px); color: var(--brand-dark,#164da8); font-weight: 700; letter-spacing: .06em; }
.demo-detail-card h3 { font: 650 var(--text-13,13px)/1.5 var(--sans,system-ui,sans-serif); margin: 4px 0 6px; }
.demo-detail-meta { display: flex; flex-wrap: wrap; gap: 5px 12px; font: var(--text-11,11px)/1.6 var(--mono,monospace); overflow-wrap: anywhere; }
.demo-detail-kind { border: 1px solid currentColor; border-radius: 4px; padding: 1px 5px; font: 600 var(--text-10,10px)/1.4 var(--mono,monospace); }
`;
const bytes = (value) =>
  value == null
    ? "Size unavailable"
    : value < 1024
      ? `${value} B`
      : `${(value / 1024).toFixed(1)} KiB`;

/** An application-owned summary followed by the complete built-in inspector. */
export function renderDemoDetails(context) {
  const { entry, document, container, renderDefault } = context;
  if (!entry) {
    renderDefault();
    return;
  }
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const style = element("style", "", styles);
  const card = element("section", "demo-detail-card");
  card.setAttribute("aria-label", "Custom application summary");
  const header = element("header", "");
  header.append(
    element("span", "demo-detail-kicker", "CUSTOM DETAILS RENDERER"),
    element("span", "demo-detail-kind", entry.kind.toUpperCase()),
  );
  let title = entry.label || "Captured request",
    details = [];
  if (entry.kind === "event") {
    title = entry.label || entry.eventType;
    details.push(entry.eventType || "Application event");
    if (entry.body?.text && entry.body.bytes.length <= 4096) {
      try {
        const data = JSON.parse(new TextDecoder().decode(entry.body.bytes));
        if (typeof data?.level === "string")
          details.push(`Level: ${data.level.slice(0, 30)}`);
        if (typeof data?.environment === "string")
          details.push(`Environment: ${data.environment.slice(0, 60)}`);
      } catch {}
    }
  } else if (entry.kind === "message") {
    title =
      entry.direction === "out"
        ? "An outgoing application message"
        : "An incoming application message";
    details.push(bytes(entry.body?.size), entry.protocol || "WebSocket frame");
  } else if (entry.kind === "socket") {
    title =
      entry.socketEvent === "close"
        ? "The connection was closed"
        : "WebSocket connection";
    details.push(String(entry.status || "WebSocket"));
    if (entry.closeCode != null)
      details.push(
        `Close ${entry.closeCode}${entry.wasClean ? " · clean" : ""}`,
      );
  } else {
    title =
      entry.kind === "resource"
        ? "A browser-loaded resource"
        : `${entry.method || "GET"} · ${entry.status || "In progress"}`;
    details.push(
      entry.end == null
        ? "In progress"
        : `${Math.max(0, entry.end - entry.start).toFixed(1)} ms`,
    );
    details.push(
      bytes(
        (entry.responseBody ?? entry.resourceBody)?.size ?? entry.transferSize,
      ),
    );
    try {
      details.push(new URL(entry.url).host);
    } catch {}
  }
  if (entry.correlationId) details.push(`Correlation: ${entry.correlationId}`);
  const meta = element("div", "demo-detail-meta");
  for (const text of details) meta.append(element("span", "", text));
  card.append(header, element("h3", "", title), meta);
  container.append(style, card);
  renderDefault();
  return () => {
    style.remove();
    card.remove();
  };
}
