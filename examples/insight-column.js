const byteSize = (value) =>
  value == null
    ? "Size unavailable"
    : value < 1024
      ? `${value} B`
      : `${(value / 1024).toFixed(1)} KiB`;
const payload = (entry) =>
  entry.responseBody ?? entry.resourceBody ?? entry.body ?? entry.requestBody;
export const recordedDuration = (entry) =>
  Number.isFinite(entry.end) ? Math.max(0, entry.end - entry.start) : 0;
export const insightSorter = (left, right) =>
  recordedDuration(left) - recordedDuration(right);

/** A complete application-owned column: actual timing, payload, and correlation data. */
export function activityInsight(entry, { container, document }) {
  const body = payload(entry),
    duration = recordedDuration(entry),
    size = byteSize(body?.size ?? entry.transferSize);
  const subtype = (body?.contentType || "").split(";")[0].split("/")[1];
  let tone = "blue",
    badge,
    detail;
  if (entry.kind === "event") {
    tone = "pink";
    badge = entry.eventType || "App event";
    detail = entry.correlationId
      ? `↳ ${entry.correlationId}`
      : `${size} · event data`;
  } else if (entry.kind === "message") {
    tone = entry.direction === "out" ? "blue" : "green";
    badge = entry.direction === "out" ? "↑ Sent" : "↓ Received";
    detail = `${size} · ${subtype || entry.protocol || "frame"}`;
  } else if (entry.kind === "socket") {
    tone = "violet";
    badge =
      entry.socketEvent === "close"
        ? "Disconnected"
        : entry.status === "Open"
          ? "Connected"
          : String(entry.status || "WebSocket");
    detail =
      entry.closeCode != null
        ? `Close ${entry.closeCode}${entry.wasClean ? " · clean" : ""}`
        : entry.end == null
          ? "Live connection"
          : `${duration.toFixed(0)} ms · connection`;
  } else if (
    (typeof entry.status === "number" && entry.status >= 400) ||
    entry.error
  ) {
    tone = "red";
    badge = entry.error ? "Request failed" : `HTTP ${entry.status}`;
    detail = `${duration.toFixed(0)} ms · ${size}`;
  } else {
    tone = duration >= 2000 ? "red" : duration >= 500 ? "amber" : "green";
    badge =
      entry.end == null
        ? "In flight"
        : `${duration < 10 ? duration.toFixed(1) : duration.toFixed(0)} ms`;
    detail = `${size} · ${subtype || entry.transport || (entry.kind === "resource" ? "resource" : "response")}`;
  }
  const wrapper = document.createElement("span");
  wrapper.className = "demo-insight";
  wrapper.dataset.tone = tone;
  const chip = document.createElement("span");
  chip.className = "demo-insight-badge";
  chip.textContent = badge;
  const meta = document.createElement("span");
  meta.className = "demo-insight-meta";
  meta.textContent = detail;
  wrapper.append(chip, meta);
  container.append(wrapper);
  container.title = `${badge} · ${detail}. Sort by recorded duration.`;
}

export const insightStyles = `
.demo-insight { display: flex; align-items: flex-start; flex-direction: column; gap: 2px; padding-block: 0; min-width: 0; }
.demo-insight-badge { --tone: var(--demo-blue,#164aa5); --wash: var(--demo-blue-wash,#eaf1ff); max-width: 100%; display: inline-block; overflow: hidden; text-overflow: ellipsis; border: 1px solid color-mix(in srgb, var(--tone) 18%, transparent); border-radius: 5px; padding: 1px 6px; background: var(--wash); color: var(--tone); font: 700 var(--text-10)/1.1 var(--mono); }
.demo-insight[data-tone="green"] .demo-insight-badge { --tone: var(--demo-green,#075d3c); --wash: var(--demo-green-wash,#e4f7ed); }
.demo-insight[data-tone="amber"] .demo-insight-badge { --tone: var(--demo-amber,#7d4400); --wash: var(--demo-amber-wash,#fff3d3); }
.demo-insight[data-tone="red"] .demo-insight-badge { --tone: var(--demo-red,#a12235); --wash: var(--demo-red-wash,#ffeaed); }
.demo-insight[data-tone="pink"] .demo-insight-badge { --tone: var(--demo-pink,#9b234d); --wash: var(--demo-pink-wash,#ffe8f1); }
.demo-insight[data-tone="violet"] .demo-insight-badge { --tone: var(--demo-violet,#623da0); --wash: var(--demo-violet-wash,#f0eaff); }
.demo-insight-meta { max-width: 100%; color: var(--muted); overflow: hidden; text-overflow: ellipsis; font: var(--text-10)/1.3 var(--mono); }
`;
