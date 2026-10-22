import { previewText } from "./network-capture.js";
import { highlightPreview } from "./syntax-highlight.js";
import { jsonBodyPreview } from "./network-json.js";

const bytes = (value) =>
  value == null
    ? "unknown size"
    : value < 1024
      ? value + " B"
      : (value / 1024).toFixed(1) + " KiB";
const ms = (value) => value.toFixed(1) + " ms";

/** Default metadata and content-type-aware previews, inside the supplied document. */
export function renderDefaultDetails({
  entry,
  selected,
  container: detail,
  document,
  store,
  select,
  showMessages,
  loadResource,
  resourcePreviews,
  name,
}) {
  const urls = [];
  let active = true;
  const source = (preview, language) => {
    const node = element("pre", "", previewText(preview));
    if (preview.text && !preview.expired && !preview.note)
      void highlightPreview(node, {
        contentType: preview.contentType,
        url: entry?.url,
        language,
        active: () => active,
      });
    return node;
  };
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  };
  const listen = (node, type, callback) =>
    node.addEventListener(type, callback);
  if (selected !== null) {
    const deselect = element(
      "button",
      "text-button network-deselect",
      "Deselect",
    );
    deselect.type = "button";
    deselect.title = "Deselect this entry and resume following if enabled";
    listen(deselect, "click", () => select(selected));
    detail.append(deselect);
  }
  if (!entry) {
    detail.append(
      element(
        "p",
        "network-empty",
        selected
          ? `Entry #${selected} expired from retained history. Select another row to inspect retained activity.`
          : "Select a request, message or event to inspect it.",
      ),
    );
    return;
  }
  detail.append(
    element("h3", "", name(entry)),
    element(
      "p",
      "network-detail-url",
      entry.url || entry.control || "Application event",
    ),
  );
  const fields = [
    ["Type", entry.kind],
    ["Status", entry.status],
    ["Started", entry.restored ? "Previous page" : ms(entry.start)],
    [
      "Duration",
      entry.end == null
        ? entry.kind === "http" || entry.kind === "socket" || entry.eventSpan
          ? "In progress"
          : "—"
        : ms(entry.end - entry.start),
    ],
    [
      "Response headers at",
      entry.headersAt == null ? null : ms(entry.headersAt - entry.start),
    ],
    ["Transfer", entry.transferSize == null ? null : bytes(entry.transferSize)],
    ["Correlation", entry.correlationId],
    ["Event type", entry.eventType],
    ["Connection", entry.connection && `#${entry.connection}`],
    ["Close code", entry.closeCode],
    ["Close reason", entry.closeReason],
    ["Clean close", entry.wasClean == null ? null : String(entry.wasClean)],
    [
      "Content type",
      entry.responseBody?.contentType ||
        entry.resourceBody?.contentType ||
        entry.body?.contentType ||
        null,
    ],
    [
      "Captured",
      entry.capturedAt == null
        ? null
        : new Date(entry.capturedAt).toISOString(),
    ],
    ["Protocol", entry.nextHopProtocol],
    [
      "Encoded body",
      entry.encodedBodySize == null ? null : bytes(entry.encodedBodySize),
    ],
    [
      "Decoded body",
      entry.decodedBodySize == null ? null : bytes(entry.decodedBodySize),
    ],
    ["Error", entry.error || entry.previewError],
  ];
  const dl = element("dl", "network-fields");
  for (const [key, value] of fields)
    if (value != null) {
      dl.append(element("dt", "", key), element("dd", "", String(value)));
    }
  if (entry.kind === "resource") {
    const metadata = element("details", "network-metadata");
    metadata.append(element("summary", "", "Original timing and metadata"), dl);
    detail.append(metadata);
  } else detail.append(dl);
  function related(label, id) {
    if (!id) return;
    const item = store.byId.get(id),
      p = element("p", "network-related", `${label}: `);
    if (item) {
      const button = element("button", "text-button", `#${id} ${name(item)}`);
      button.type = "button";
      listen(button, "click", () => select(id));
      p.append(button);
    } else p.append(document.createTextNode(`#${id} (expired)`));
    detail.append(p);
  }
  related(
    entry.kind === "http" ? "Initiating event" : "Linked event",
    entry.eventId,
  );
  if (entry.nearEvent !== entry.eventId)
    related("Previous event in time", entry.nearEvent);
  if (entry.kind === "socket") {
    const button = element(
      "button",
      "button",
      "Show this connection’s messages",
    );
    button.type = "button";
    listen(button, "click", () => {
      showMessages(entry.connection ?? entry.id);
    });
    detail.append(button);
  }
  if (entry.note && entry.kind !== "resource")
    detail.append(element("p", "network-note", entry.note));
  if (entry.kind === "resource" && loadResource) {
    const load = () => {
      void loadResource(entry).catch((error) =>
        store.update(entry, {
          resourcePreviewStatus: "Failed",
          previewError: error.message,
        }),
      );
    };
    if (
      resourcePreviews === "on-select" &&
      !entry.resourceBody &&
      (!entry.resourcePreviewStatus ||
        entry.resourcePreviewStatus === "Interrupted by page reload")
    )
      queueMicrotask(load);
    if (
      resourcePreviews !== "on-select" ||
      entry.resourcePreviewStatus === "Failed"
    ) {
      const button = element(
        "button",
        "button",
        entry.resourcePreviewStatus === "Loading"
          ? "Loading resource preview…"
          : entry.resourcePreviewStatus === "Failed"
            ? "Retry resource preview"
            : "Load resource preview",
      );
      button.type = "button";
      button.disabled = entry.resourcePreviewStatus === "Loading";
      listen(button, "click", load);
      detail.append(button);
    }
    detail.append(
      element(
        "p",
        "network-note",
        resourcePreviews === "on-select"
          ? "Response preview from a separate, cache-preferred GET. Original browser-managed request headers are not exposed."
          : "Makes a separate GET, preferring the browser cache. Its headers and body can differ from the original load. Browser-managed request headers are not exposed.",
      ),
    );
    if (entry.resourcePreviewStatus)
      detail.append(
        element(
          "p",
          "network-note",
          `Resource preview: ${entry.resourcePreviewStatus}${entry.resourceStatus == null ? "" : ` · HTTP ${entry.resourceStatus}`}`,
        ),
      );
  }
  for (const [key, label] of [
    ["requestHeaders", "Request headers"],
    ["responseHeaders", "Response headers"],
    ["resourceRequestHeaders", "Preview request headers"],
    ["resourceResponseHeaders", "Preview response headers"],
  ])
    if (entry[key] != null) {
      const section = element("details");
      section.open = true;
      section.append(
        element("summary", "", label),
        element(
          "pre",
          "",
          entry[key] || "No JavaScript-visible headers captured.",
        ),
      );
      detail.append(section);
    }
  for (const [key, label] of [
    ["requestBody", "Request body"],
    ["responseBody", "Response body"],
    ["body", entry.kind === "event" ? "Event data" : "Message"],
    ["resourceBody", "Loaded resource body"],
  ])
    if (entry[key]) {
      const preview = entry[key],
        section = element("section", "network-preview");
      const type = (preview.contentType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const json =
        !type || /(?:json|javascript)$/.test(type)
          ? jsonBodyPreview(preview, document)
          : null;
      section.append(
        element(
          "h4",
          "",
          `${label} · ${json ? "JSON" : preview.text ? "Text" : "Hex"} · ${bytes(preview.size)}`,
        ),
      );
      if (preview.truncated)
        section.append(
          element(
            "p",
            "network-note",
            `Beginning only · retained ${bytes(preview.bytes.length)}${preview.size != null ? ` of ${bytes(preview.size)}` : ""}.`,
          ),
        );
      if (json) {
        const raw = element("details", "network-json-raw");
        raw.append(
          element(
            "summary",
            "",
            preview.truncated ? "Raw preview" : "Raw JSON",
          ),
          source(preview, "json"),
        );
        section.append(json, raw);
      } else if (!preview.expired && !preview.note && type === "text/html") {
        const frame = element("iframe", "network-html-preview");
        frame.title = `${label} HTML preview`;
        frame.setAttribute("sandbox", "");
        frame.referrerPolicy = "no-referrer";
        // Give unstyled HTML the preview's canvas and text colors. Authored
        // document styles still take precedence inside the opaque sandbox.
        const palette = document.defaultView.getComputedStyle(detail);
        const canvas = element("style", "");
        canvas.textContent = `:root { color-scheme: ${palette.colorScheme}; } body { color: ${palette.getPropertyValue("--ink") || palette.color}; background: ${palette.getPropertyValue("--panel") || palette.backgroundColor}; }`;
        frame.srcdoc =
          "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'\"><meta name=\"referrer\" content=\"no-referrer\">" +
          canvas.outerHTML +
          previewText(preview);
        section.append(frame, source(preview, "xml"));
      } else if (
        !preview.expired &&
        !preview.note &&
        !preview.truncated &&
        /^(image|audio|video)\//.test(type)
      ) {
        const url = document.defaultView.URL.createObjectURL(
          new Blob([preview.bytes], { type }),
        );
        urls.push(url);
        const media = element(
          type.startsWith("image/") ? "img" : type.split("/")[0],
          "network-media-preview",
        );
        media.src = url;
        if (media.tagName === "IMG") media.alt = `${label} preview`;
        else media.controls = true;
        section.append(media);
      } else section.append(source(preview));
      detail.append(section);
    }
  return () => {
    active = false;
    for (const url of urls) document.defaultView.URL.revokeObjectURL(url);
  };
}

/** Own one sandboxed document and dispose custom rendering on replacement. */
export function createDetailView(container, options) {
  const {
    scope,
    root,
    store,
    name,
    select,
    showMessages,
    loadResource,
    resourcePreviews,
    detailFrame = true,
  } = options;
  let renderDetails = options.renderDetails ?? renderDefaultDetails;
  let document,
    body,
    current = null,
    selected = null,
    disposed = false,
    cleanup = null,
    generation = 0,
    resetScroll = true;
  let frame = null;
  function clear() {
    const previous = cleanup;
    cleanup = null;
    try {
      previous?.();
    } catch {
      // Application cleanup cannot interrupt capture teardown.
    }
  }
  function draw() {
    if (disposed || !body) return;
    const revision = ++generation;
    const scroll = document?.scrollingElement,
      top = resetScroll ? 0 : (scroll?.scrollTop ?? 0);
    resetScroll = false;
    clear();
    if (disposed || revision !== generation) return;
    body.replaceChildren();
    const defaults = [];
    const context = {
      entry: current,
      selected,
      container: body,
      document,
      iframe: frame,
      store,
      name,
      select,
      showMessages,
      loadResource,
      resourcePreviews,
    };
    context.renderDefault = () => {
      const dispose = renderDefaultDetails(context);
      if (typeof dispose === "function") defaults.push(dispose);
    };
    try {
      const result =
        renderDetails === renderDefaultDetails
          ? (context.renderDefault(), null)
          : renderDetails(context);
      const dispose = () => {
        try {
          if (typeof result === "function") result();
        } finally {
          for (const fn of defaults) fn();
        }
      };
      if (disposed || revision !== generation) dispose();
      else cleanup = dispose;
      if (scroll && revision === generation) scroll.scrollTop = top;
    } catch (error) {
      for (const fn of defaults) fn();
      body.textContent = `Details renderer failed: ${error.message}`;
    }
  }
  if (detailFrame) {
    frame = container.ownerDocument.createElement("iframe");
    frame.className = "network-detail-frame";
    frame.title = "Activity details";
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.referrerPolicy = "no-referrer";
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' http: https: blob:; img-src blob: data:; media-src blob: data:; frame-src 'self'; form-action 'none'; base-uri 'none'"></head><body class="network-detail-content"></body></html>`;
    frame.addEventListener("load", () => {
      if (disposed) return;
      document = frame.contentDocument;
      if (!document?.body) return;
      body = document.body;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = root.querySelector('link[rel="stylesheet"]').href;
      document.head.append(link);
      const style = scope.getComputedStyle(root.host);
      for (let i = 0; i < style.length; i++) {
        const key = style[i];
        if (key.startsWith("--"))
          document.documentElement.style.setProperty(
            key,
            style.getPropertyValue(key),
          );
      }
      draw();
    });
    container.replaceChildren(frame);
  } else {
    document = container.ownerDocument ?? root.ownerDocument;
    body = container;
  }
  return {
    setRenderer(renderer = renderDefaultDetails) {
      if (typeof renderer !== "function")
        throw new TypeError(
          "Details renderer must be a function or undefined.",
        );
      renderDetails = renderer;
      draw();
    },
    render(entry, id) {
      if (selected !== id) resetScroll = true;
      current = entry;
      selected = id;
      draw();
    },
    destroy() {
      disposed = true;
      generation++;
      clear();
      frame?.remove();
    },
  };
}
