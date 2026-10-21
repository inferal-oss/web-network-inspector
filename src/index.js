import {
  restoreViewState,
  createWebStorage,
  persistView,
} from "./view-preferences.js";
import { normalizeColumns } from "./columns.js";
import { NetworkCapture, installNetworkCapture } from "./network-capture.js";
import { setupNetworkActivity } from "./network-activity.js";
import { panelHTML } from "./template.js";
export {
  NetworkCapture,
  installNetworkCapture,
  bodyPreview,
  previewText,
  captureLimits,
  retentionBounds,
} from "./network-capture.js";

/** Create an independent UI. Share a store with capture:false for additional views. */
export function createInspector({
  scope = globalThis.window,
  container = scope?.document.body,
  store,
  filter,
  capture = true,
  open = false,
  stylesheet = new URL("./style.css", import.meta.url).href,
  nonce,
  resourcePreviews = "manual",
  columns,
  renderDetails,
  viewState,
  includePreviousPageLoads = true,
} = {}) {
  columns = normalizeColumns(columns);
  if (typeof includePreviousPageLoads !== "boolean")
    throw new TypeError("includePreviousPageLoads must be a boolean.");
  const columnCatalog = columns;
  const initialView = restoreViewState(
    columns,
    viewState,
    includePreviousPageLoads,
  );
  columns = initialView.columns;
  if (!["manual", "on-select"].includes(resourcePreviews))
    throw new TypeError("resourcePreviews must be manual or on-select.");
  if (renderDetails !== undefined && typeof renderDetails !== "function")
    throw new TypeError("renderDetails must be a function.");
  if (store && filter !== undefined)
    throw new TypeError(
      "Set filter on a shared NetworkCapture instead of on the view.",
    );
  store ??= new NetworkCapture({ filter });
  if (!container?.append) throw new TypeError("A DOM container is required.");
  const document = container.ownerDocument;
  const transport = capture ? installNetworkCapture(scope, store) : null;
  const host = document.createElement("div");
  host.setAttribute("data-web-network-inspector", "");
  const root = host.attachShadow({ mode: "open" });
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = stylesheet;
  if (nonce) link.nonce = nonce;
  const template = document.createElement("template");
  template.innerHTML = panelHTML;
  root.append(link, template.content.cloneNode(true));
  container.append(host);
  const ui = setupNetworkActivity(root, scope, store, {
    renderDetails,
    columns,
    columnCatalog,
    initialView,
    resourcePreviews,
    loadResource: transport?.loadResource,
  });
  const items = new Map();
  let popup = null,
    popupAnchor = null,
    destroyed = false,
    serial = 0;
  const ensure = () => {
    if (destroyed) throw new Error("Inspector has been destroyed.");
  };
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  function openPopup({
    title = "Details",
    content = "",
    anchor = null,
    onClose,
  } = {}) {
    ensure();
    popup?.close(false);
    const element = make("section");
    element.className = "network-popup";
    element.setAttribute("role", "dialog");
    const heading = make("h3", title);
    heading.id = `network-popup-title-${++serial}`;
    element.setAttribute("aria-labelledby", heading.id);
    const closeButton = make("button", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close popup");
    const header = make("header");
    header.append(heading, closeButton);
    const body = make("div");
    body.className = "network-popup-content";
    element.append(header, body);
    const previous = anchor ?? root.activeElement ?? document.activeElement;
    let closed = false,
      cleanup = null;
    const handle = {
      element,
      update({ title, content } = {}) {
        if (closed) return;
        if (title !== undefined) heading.textContent = title;
        if (content !== undefined) {
          const previousCleanup = cleanup;
          cleanup = null;
          if (typeof previousCleanup === "function") previousCleanup();
          if (closed) return;
          body.replaceChildren();
          if (typeof content === "function") {
            const nextCleanup = content({
              container: body,
              close: () => handle.close(),
            });
            // The renderer may close, replace, or destroy this popup before
            // returning resources for us to dispose.
            if (closed) {
              if (typeof nextCleanup === "function") nextCleanup();
            } else cleanup = nextCleanup;
          } else if (content?.nodeType) body.append(content);
          else body.textContent = String(content);
        }
      },
      close(restoreFocus = true) {
        if (closed) return;
        closed = true;
        const dispose = cleanup;
        cleanup = null;
        try {
          if (typeof dispose === "function") dispose();
        } finally {
          element.remove();
          if (anchor) anchor.setAttribute("aria-expanded", "false");
          if (popup === handle) {
            popup = null;
            popupAnchor = null;
          }
          if (restoreFocus && previous?.isConnected) previous.focus();
          onClose?.();
        }
      },
    };
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handle.close();
      }
    });
    closeButton.addEventListener("click", () => handle.close());
    popup = handle;
    popupAnchor = anchor;
    root.getElementById("network-popups").append(element);
    if (anchor) {
      anchor.setAttribute("aria-haspopup", "dialog");
      anchor.setAttribute("aria-expanded", "true");
    }
    try {
      handle.update({ content });
      if (!closed) closeButton.focus();
    } catch (error) {
      handle.close();
      throw error;
    }
    return handle;
  }
  function addBarItem({
    id,
    label = "",
    title = "",
    element = null,
    onClick,
  } = {}) {
    ensure();
    if (typeof id !== "string" || !id || items.has(id))
      throw new TypeError("Bar items require a unique nonempty string id.");
    const node = element ?? make("button", label);
    if (node?.nodeType !== 1)
      throw new TypeError("element must be a DOM element.");
    if (node.tagName === "BUTTON") node.type = "button";
    if (title) node.title = title;
    const click = (event) =>
      onClick?.({ event, inspector: api, element: node });
    if (onClick) node.addEventListener("click", click);
    let removed = false;
    const item = {
      element: node,
      update(values = {}) {
        if (removed) return;
        if (values.label !== undefined) node.textContent = values.label;
        if (values.title !== undefined) node.title = values.title;
        if (values.disabled !== undefined) node.disabled = !!values.disabled;
      },
      remove() {
        if (removed) return;
        removed = true;
        if (popupAnchor && node.contains(popupAnchor)) popup.close(false);
        node.removeEventListener("click", click);
        node.remove();
        items.delete(id);
      },
    };
    items.set(id, item);
    root.getElementById("network-items").append(node);
    return item;
  }
  const api = {
    host,
    root,
    store,
    setDetailsRenderer(renderer) {
      ensure();
      ui.setDetailsRenderer(renderer);
    },
    getViewState() {
      ensure();
      return ui.getViewState();
    },
    setViewState(state) {
      ensure();
      ui.setViewState(state);
    },
    subscribeView(listener) {
      ensure();
      return ui.subscribeView(listener);
    },
    getIncludePreviousPageLoads() {
      ensure();
      return ui.getIncludePreviousPageLoads();
    },
    setIncludePreviousPageLoads(value) {
      ensure();
      ui.setIncludePreviousPageLoads(value);
    },
    getColumns() {
      ensure();
      return ui.getColumns();
    },
    setColumns(columns) {
      ensure();
      ui.setColumns(columns);
    },
    loadResource(entry) {
      ensure();
      if (!transport)
        throw new Error("This view does not own network capture.");
      return transport.loadResource(entry);
    },
    recordEvent(event) {
      ensure();
      return store.recordEvent(event);
    },
    subscribe(listener) {
      ensure();
      return store.subscribe(listener);
    },
    annotateMessage(...args) {
      ensure();
      if (!transport)
        throw new Error(
          "This view does not own network capture. Use the capture owner to annotate messages.",
        );
      return transport.annotateMessage(...args);
    },
    addBarItem,
    openPopup,
    setOpen(value) {
      ensure();
      ui.setOpen(!!value);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        popup?.close(false);
      } finally {
        for (const item of items.values()) item.remove();
        ui.destroy();
        transport?.disconnect();
        host.remove();
      }
    },
  };
  ui.setOpen(!!open);
  return api;
}

export { renderDefaultDetails } from "./detail-renderer.js";
export { createPersistentCapture, createIndexedDBStorage } from "./storage.js";

export {
  byHostnames,
  byOrigins,
  byMethods,
  allOf,
  anyOf,
  not,
} from "./filters.js";

export {
  hostPath,
  status,
  size,
  code,
  waterfall,
  columnRenderers,
  defaultColumns,
  sizeSorter,
} from "./columns.js";

export { createWebStorage } from "./view-preferences.js";

/** Restore view settings before mounting; history remains a separate store. */
export async function createPersistentInspector({ storage, ...options } = {}) {
  const scope = options.scope ?? globalThis.window;
  storage ??= createWebStorage({ storage: () => scope.localStorage });
  if (
    typeof storage?.load !== "function" ||
    typeof storage?.save !== "function"
  )
    throw new TypeError("storage requires load() and save(snapshot).");
  let snapshot,
    loadError = null;
  try {
    snapshot = await storage.load();
  } catch (error) {
    loadError = String(error?.message ?? error);
  }
  let inspector;
  try {
    inspector = createInspector({
      ...options,
      viewState: snapshot ?? options.viewState,
    });
  } catch (error) {
    try {
      await storage.close?.();
    } catch {}
    throw error;
  }
  const preferences = persistView(inspector, storage, scope, loadError);
  inspector.preferences = preferences;
  const destroy = inspector.destroy;
  inspector.destroy = () => {
    void preferences.close();
    destroy();
  };
  return inspector;
}
