// This recorder belongs to one page load. It never writes to storage or a server.
export const captureLimits = Object.freeze({
  preview: 16 * 1024,
  bytes: 8 * 1024 * 1024,
  entries: 2000,
  messages: 1000,
  readers: 8,
});
export const retentionBounds = Object.freeze({
  preview: 1024 * 1024,
  bytes: 1024 * 1024 * 1024,
  entries: 100000,
  messages: 100000,
});
const encoder = new TextEncoder();
const installations = new WeakMap();
const short = (value, max = 2048) => String(value ?? "").slice(0, max);
function utf8Size(text) {
  let size = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) size++;
    else if (code < 2048) size += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      size += 4;
      i++;
    } else size += 3;
  }
  return size;
}
export function bodyPreview(value, limit = captureLimits.preview, type = "") {
  if (value == null)
    return { bytes: new Uint8Array(), size: 0, text: true, truncated: false };
  if (typeof value === "string") {
    const bytes = new Uint8Array(Math.min(limit, value.length * 3));
    const { written } = encoder.encodeInto(value, bytes);
    const size = utf8Size(value);
    return {
      bytes: bytes.slice(0, written),
      size,
      text: true,
      truncated: size > written,
    };
  }
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
  if (bytes)
    return {
      bytes: bytes.slice(0, limit),
      size: bytes.byteLength,
      text: /^(text\/)|json|xml|javascript|svg|form-urlencoded/i.test(type),
      truncated: bytes.byteLength > limit,
    };
  return {
    bytes: new Uint8Array(),
    size: null,
    text: true,
    truncated: false,
    note: "Preview unavailable for this body type; the original body is untouched.",
  };
}
export function previewText(preview) {
  if (!preview) return "No preview captured.";
  if (preview.expired)
    return "Preview expired to keep capture within its memory budget.";
  if (preview.note) return preview.note;
  if (preview.text) return new TextDecoder().decode(preview.bytes);
  const lines = [];
  for (let i = 0; i < preview.bytes.length; i += 16) {
    const row = preview.bytes.subarray(i, i + 16);
    lines.push(
      `${i.toString(16).padStart(6, "0")}  ${Array.from(row, (b) =>
        b.toString(16).padStart(2, "0"),
      )
        .join(" ")
        .padEnd(
          47,
        )}  ${Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("")}`,
    );
  }
  return lines.join("\n");
}

export class NetworkCapture {
  constructor({ now = () => performance.now(), limits = {} } = {}) {
    this.now = now;
    this.limits = { ...captureLimits };
    this.entries = [];
    this.byId = new Map();
    this.serial = 0;
    this.generation = 0;
    this.bytes = 0;
    this.expired = 0;
    this.expiredPreviews = 0;
    this.paused = false;
    this.listeners = new Set();
    this.lastEvent = null;
    this.activeEvent = null;
    this.eventResetScheduled = false;
    const { readers = captureLimits.readers, ...retention } = limits;
    if (!Number.isSafeInteger(readers) || readers < 1 || readers > 64)
      throw new RangeError("Invalid reader limit");
    this.limits.readers = readers;
    this.setLimits(retention);
  }
  changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot interrupt recording. */
      }
    }
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  recordEvent({
    type = "event",
    label = type,
    data,
    correlationId = null,
    parentId = this.activeEvent,
  } = {}) {
    const entry = this.add({
      kind: "event",
      eventType: short(type, 80),
      label: short(label, 160),
      correlationId: correlationId == null ? null : short(correlationId, 128),
      eventId: parentId,
      status: "Event",
    });
    if (data !== undefined)
      this.preview(entry, "body", bodyPreview(data, this.limits.preview));
    return entry;
  }
  setLimits(changes) {
    // Validate the whole update before changing limits or discarding history.
    for (const [key, value] of Object.entries(changes))
      if (
        !Object.hasOwn(retentionBounds, key) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > retentionBounds[key]
      )
        throw new RangeError(`Invalid retention limit: ${key}`);
    Object.assign(this.limits, changes);
    const counts = new Map();
    for (const entry of [...this.entries].reverse())
      if (entry.kind === "message") {
        const count = (counts.get(entry.connection) ?? 0) + 1;
        counts.set(entry.connection, count);
        if (count > this.limits.messages) this.remove(entry);
      }
    while (this.entries.length > this.limits.entries)
      this.remove(this.entries[0]);
    for (const entry of this.entries)
      for (const key of ["requestBody", "responseBody", "body"])
        if (entry[key]) {
          const previous = entry[key],
            trimmed = this.trimPreview(previous);
          this.bytes += trimmed.bytes.byteLength - previous.bytes.byteLength;
          entry[key] = trimmed;
        }
    this.expirePreviews();
    this.changed();
  }
  trimPreview(preview) {
    if (preview.bytes.byteLength <= this.limits.preview) return preview;
    let end = this.limits.preview;
    if (preview.text)
      while (end > 0 && (preview.bytes[end] & 0xc0) === 0x80) end--;
    return { ...preview, bytes: preview.bytes.slice(0, end), truncated: true };
  }
  clear() {
    for (const entry of [...this.entries]) this.remove(entry);
    this.expired = 0;
    this.expiredPreviews = 0;
    this.lastEvent = null;
    this.activeEvent = null;
    this.generation++;
    this.changed();
  }
  add(data) {
    if (this.paused) return null;
    const entry = {
      id: ++this.serial,
      start: this.now(),
      generation: this.generation,
      nearEvent: this.lastEvent,
      eventId: null,
      ...data,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    if (entry.kind === "event") {
      this.lastEvent = entry.id;
      this.activeEvent = entry.id;
      if (!this.eventResetScheduled) {
        this.eventResetScheduled = true;
        // Browser event dispatch can run microtasks between capture and target
        // listeners. Keep this context through the complete event task.
        setTimeout(() => {
          this.activeEvent = null;
          this.eventResetScheduled = false;
        }, 0);
      }
    }
    if (entry.kind === "message") {
      const messages = this.entries.filter(
        (item) =>
          item.kind === "message" && item.connection === entry.connection,
      );
      while (messages.length > this.limits.messages)
        this.remove(messages.shift());
    }
    while (this.entries.length > this.limits.entries)
      this.remove(this.entries[0]);
    this.changed();
    return entry;
  }
  has(entry) {
    return !!entry && this.byId.get(entry.id) === entry;
  }
  remove(entry) {
    if (!this.has(entry)) return;
    this.entries.splice(this.entries.indexOf(entry), 1);
    this.byId.delete(entry.id);
    this.expired++;
    for (const part of ["requestBody", "responseBody", "body"])
      if (entry[part]) {
        this.bytes -= entry[part].bytes.byteLength;
        entry[part] = {
          ...entry[part],
          bytes: new Uint8Array(),
          expired: true,
        };
      }
    // Pending transport callbacks may still hold this object after its eviction.
    for (const key of Object.keys(entry))
      if (
        !["id", "generation", "requestBody", "responseBody", "body"].includes(
          key,
        )
      )
        delete entry[key];
  }
  update(entry, data) {
    if (this.has(entry)) {
      Object.assign(entry, data);
      this.changed();
    }
  }
  preview(entry, part, preview) {
    if (!this.has(entry) || this.paused) return;
    preview = this.trimPreview(preview);
    this.bytes -= entry[part]?.bytes?.byteLength ?? 0;
    entry[part] = preview;
    this.bytes += preview.bytes.byteLength;
    this.expirePreviews();
    this.changed();
  }
  expirePreviews() {
    for (const item of this.entries) {
      if (this.bytes <= this.limits.bytes) break;
      for (const key of ["requestBody", "responseBody", "body"]) {
        const previous = item[key];
        if (!previous?.bytes?.byteLength) continue;
        this.bytes -= previous.bytes.byteLength;
        item[key] = { ...previous, bytes: new Uint8Array(), expired: true };
        this.expiredPreviews++;
        if (this.bytes <= this.limits.bytes) break;
      }
    }
  }
}

function headersPreview(headers) {
  // Headers are metadata, but still need a bound.
  let result = "",
    count = 0;
  for (const [key, value] of new Headers(headers)) {
    if (++count > 80 || result.length >= 8192) {
      result += "\n… headers truncated";
      break;
    }
    result += `${short(key, 128)}: ${short(value, 1024)}\n`;
  }
  return result.slice(0, 8192);
}

function prepareFetchInit(init) {
  const headers = init?.headers;
  if (headers == null || typeof headers[Symbol.iterator] !== "function")
    return init;
  // A HeadersInit iterator may be usable only once. Normalize it before either
  // capture or fetch reads it. Let iterator errors reject the request as usual.
  const normalized = new Headers(headers);
  const descriptors = Object.getOwnPropertyDescriptors(init);
  descriptors.headers = { value: normalized, enumerable: true };
  const target = Object.create(Object.getPrototypeOf(init), descriptors);
  // Keep inherited options and getter receivers, including on frozen inputs.
  return new Proxy(target, {
    get: (_target, key) =>
      key === "headers" ? normalized : Reflect.get(init, key, init),
  });
}

/** Wrap the page's transports. Return native responses and sockets to callers. */
export function installNetworkCapture(scope, store = new NetworkCapture()) {
  if (installations.has(scope))
    throw new Error(
      "Network capture is already installed on this scope. Share its store instead.",
    );
  const originalFetch = scope.fetch,
    OriginalSocket = scope.WebSocket,
    OriginalXHR = scope.XMLHttpRequest;
  const sockets = new WeakMap(),
    cleanups = new Set(),
    activeReaders = new Set();
  let readers = 0,
    connected = true;
  const listen = (target, type, callback) => {
    const wrapped = (...args) => {
      if (connected) callback(...args);
    };
    target.addEventListener(type, wrapped);
    const remove = () => {
      target.removeEventListener(type, wrapped);
      cleanups.delete(remove);
    };
    cleanups.add(remove);
    return remove;
  };
  const safe = (fn) => {
    if (!connected) return;
    try {
      return fn();
    } catch {
      return undefined;
    }
  };
  const fullUrl = (value) =>
    safe(() => new URL(value, scope.location?.href).href) ?? short(value);
  function captureBody(entry, part, value, type = "") {
    if (!connected || !store.has(entry) || store.paused) return;
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      if (readers >= store.limits.readers) {
        store.preview(entry, part, {
          ...bodyPreview(null),
          size: value.size,
          note: "Preview skipped: capture readers busy.",
        });
        return;
      }
      // Slice before the asynchronous read; never retain the complete Blob.
      const size = value.size,
        slice = value.slice(0, store.limits.preview),
        contentType = type || value.type;
      readers++;
      slice
        .arrayBuffer()
        .then((bytes) => {
          if (!connected) return;
          const preview = bodyPreview(bytes, store.limits.preview, contentType);
          store.preview(entry, part, {
            ...preview,
            size,
            truncated: preview.truncated || size > bytes.byteLength,
          });
        })
        .catch(() => {})
        .finally(() => readers--);
    } else
      store.preview(
        entry,
        part,
        bodyPreview(value, store.limits.preview, type),
      );
  }
  function responsePreview(entry, response) {
    if (!response.body || !store.has(entry) || store.paused) return;
    if (readers >= store.limits.readers) {
      store.preview(entry, "responseBody", {
        ...bodyPreview(null),
        size: null,
        note: "Preview skipped: capture readers busy.",
      });
      return;
    }
    const reader = response.clone().body.getReader(),
      parts = [];
    let length = 0,
      finished = false,
      timedOut = false;
    readers++;
    // Never wait for clone cancellation: its promise can wait for the caller's body.
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    const stop = () => {
      clearTimeout(timeout);
      cancel();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      cancel();
    }, 10000);
    activeReaders.add(stop);
    void (async () => {
      try {
        while (
          connected &&
          length < store.limits.preview &&
          store.has(entry) &&
          !store.paused
        ) {
          const { done, value } = await reader.read();
          if (done) {
            finished = !timedOut;
            break;
          }
          const part = value.subarray(
            0,
            Math.max(0, store.limits.preview - length),
          );
          parts.push(part.slice());
          length += part.byteLength;
          if (part.byteLength < value.byteLength) break;
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        const declared = response.headers.get("content-length"),
          encoded = response.headers.get("content-encoding");
        const declaredSize = declared && !encoded ? Number(declared) : NaN;
        const size = finished
          ? length
          : Number.isFinite(declaredSize) && declaredSize >= length
            ? declaredSize
            : null;
        const preview = bodyPreview(
          bytes,
          store.limits.preview,
          response.headers.get("content-type") || "",
        );
        if (connected)
          store.preview(entry, "responseBody", {
            ...preview,
            size,
            truncated:
              preview.truncated ||
              (!finished && (size == null || size > length)),
          });
        if (timedOut)
          store.update(entry, {
            previewError:
              "Response preview stopped after 10 seconds; the request continues.",
          });
      } catch {
        if (connected)
          store.update(entry, {
            previewError: "Response preview interrupted.",
          });
      } finally {
        stop();
        activeReaders.delete(stop);
        readers--;
      }
    })();
  }
  if (originalFetch)
    scope.fetch = async function (input, init) {
      init = prepareFetchInit(init);
      let entry;
      safe(() => {
        const request =
          typeof Request !== "undefined" && input instanceof Request
            ? input
            : null;
        const headers = init?.headers ?? request?.headers;
        entry = store.add({
          kind: "http",
          transport: "fetch",
          method: short(init?.method ?? request?.method ?? "GET", 32),
          url: short(fullUrl(request?.url ?? input)),
          status: "Pending",
          requestHeaders: headersPreview(headers),
        });
        if (entry && init?.body != null)
          captureBody(
            entry,
            "requestBody",
            init.body,
            new Headers(headers).get("content-type") || "",
          );
        else if (entry && request?.body)
          store.preview(entry, "requestBody", {
            ...bodyPreview(null),
            size: null,
            note: "Request stream is not read by the recorder.",
          });
      });
      try {
        safe(() => store.update(entry, { networkStart: store.now() }));
        const response = await originalFetch.call(this, input, init);
        safe(() => {
          store.update(entry, {
            status: response.status,
            headersAt: store.now(),
            end: store.now(),
            responseHeaders: headersPreview(response.headers),
          });
          responsePreview(entry, response);
        });
        return response;
      } catch (error) {
        safe(() =>
          store.update(entry, {
            status: error.name === "AbortError" ? "Cancelled" : "Failed",
            error: short(error.message),
            end: store.now(),
          }),
        );
        throw error;
      }
    };
  if (OriginalSocket) {
    // A constructor proxy preserves the native prototype, constants and instanceof.
    scope.WebSocket = new Proxy(OriginalSocket, {
      construct(Target, args, newTarget) {
        const socket = Reflect.construct(Target, args, newTarget);
        const state = { connection: null, in: null, out: null };
        const socketCleanups = [];
        const on = (type, callback) =>
          socketCleanups.push(listen(socket, type, callback));
        sockets.set(socket, state);
        safe(() => {
          state.connection = store.add({
            kind: "socket",
            url: short(socket.url),
            status: "Connecting",
          });
        });
        on("open", () =>
          safe(() =>
            store.update(state.connection, {
              status: "Open",
              openedAt: store.now(),
            }),
          ),
        );
        on("error", () =>
          safe(() =>
            store.update(state.connection, {
              status: "Error",
              error: "WebSocket connection error",
            }),
          ),
        );
        on("close", (event) => {
          safe(() =>
            store.update(state.connection, {
              status: "Closed",
              end: store.now(),
              closeCode: event.code,
              closeReason: short(event.reason),
            }),
          );
          for (const cleanup of socketCleanups) cleanup();
        });
        const message = (direction, data) =>
          safe(() => {
            if (
              (!state.connection ||
                state.connection.generation !== store.generation) &&
              !store.paused
            )
              state.connection = store.add({
                kind: "socket",
                url: short(socket.url),
                status: socket.readyState === 1 ? "Open" : "Closed",
                note: "Connection already existed when this capture began.",
              });
            const entry = store.add({
              kind: "message",
              connection: state.connection?.id,
              direction,
              url: short(socket.url),
              status: direction === "in" ? "Received" : "Sent",
            });
            state[direction] = entry?.id ?? null;
            captureBody(entry, "body", data);
          });
        on("message", (event) => message("in", event.data));
        const send = socket.send;
        const wrappedSend = function (data) {
          const result = send.call(this, data);
          if (connected) message("out", data);
          return result;
        };
        socket.send = wrappedSend;
        const restoreSend = () => {
          if (socket.send === wrappedSend) socket.send = send;
          cleanups.delete(restoreSend);
        };
        cleanups.add(restoreSend);
        socketCleanups.push(restoreSend);
        return socket;
      },
    });
  }
  // Keep the wrapper useful for libraries that use XMLHttpRequest as well.
  if (OriginalXHR)
    scope.XMLHttpRequest = class extends OriginalXHR {
      open(method, url, ...rest) {
        const result = super.open(method, url, ...rest);
        safe(() => {
          this.activityMethod = short(method, 32);
          this.activityUrl = short(fullUrl(url));
          this.activityHeaders = "";
        });
        return result;
      }
      setRequestHeader(key, value) {
        const result = super.setRequestHeader(key, value);
        safe(() => {
          this.activityHeaders = short(
            `${this.activityHeaders}${short(key, 128)}: ${short(value, 1024)}\n`,
            8192,
          );
        });
        return result;
      }
      send(body) {
        let entry;
        safe(() => {
          entry = store.add({
            kind: "http",
            transport: "XHR",
            method: this.activityMethod,
            url: this.activityUrl,
            status: "Pending",
            requestHeaders: this.activityHeaders,
          });
          captureBody(entry, "requestBody", body);
        });
        const complete = () =>
          safe(() => {
            store.update(entry, {
              status: this.status || "Failed",
              end: store.now(),
              responseHeaders: short(this.getAllResponseHeaders(), 8192),
            });
            captureBody(
              entry,
              "responseBody",
              this.response,
              this.getResponseHeader("content-type") || "",
            );
          });
        this.addEventListener("loadend", complete, { once: true });
        safe(() => store.update(entry, { networkStart: store.now() }));
        try {
          return super.send(body);
        } catch (error) {
          this.removeEventListener("loadend", complete);
          safe(() =>
            store.update(entry, {
              status: "Failed",
              end: store.now(),
              error: short(error.message),
            }),
          );
          throw error;
        }
      }
    };
  let observer;
  if (scope.PerformanceObserver)
    safe(() => {
      observer = new scope.PerformanceObserver((list) => {
        for (const resource of list.getEntries())
          safe(() => {
            if (["fetch", "xmlhttprequest"].includes(resource.initiatorType)) {
              const transport =
                resource.initiatorType === "fetch" ? "fetch" : "XHR";
              const candidates = store.entries.filter(
                (e) =>
                  e.kind === "http" &&
                  e.transport === transport &&
                  !e.timingRecorded &&
                  e.url === short(resource.name) &&
                  Math.abs((e.networkStart ?? e.start) - resource.startTime) <
                    100,
              );
              const entry = candidates.sort(
                (a, b) =>
                  Math.abs((a.networkStart ?? a.start) - resource.startTime) -
                  Math.abs((b.networkStart ?? b.start) - resource.startTime),
              )[0];
              store.update(entry, {
                start: resource.startTime,
                end: resource.responseEnd,
                ...(resource.responseStart
                  ? { headersAt: resource.responseStart }
                  : {}),
                transferSize: resource.transferSize,
                timingRecorded: true,
              });
              return;
            }
            const nearEvent =
              store.entries.findLast(
                (e) => e.kind === "event" && e.start <= resource.startTime,
              )?.id ?? null;
            store.add({
              kind: "resource",
              url: short(resource.name),
              method: "GET",
              transport: short(resource.initiatorType, 40),
              start: resource.startTime,
              end: resource.responseEnd,
              transferSize: resource.transferSize,
              status: "Loaded",
              nearEvent,
              note: "Browser resource timing only; body and headers are unavailable.",
            });
          });
      });
      observer.observe({ type: "resource", buffered: true });
    });
  /** Attach application-supplied metadata to the latest frame in this direction. */
  function annotateMessage(
    socket,
    direction,
    { type, label, correlationId, eventId } = {},
  ) {
    if (!["in", "out"].includes(direction))
      throw new TypeError("Direction must be in or out.");
    const state = sockets.get(socket),
      entry = store.byId.get(state?.[direction]);
    if (!connected || !entry) return null;
    store.update(entry, {
      protocol: short(type, 80),
      label: label == null ? null : short(label, 160),
      correlationId: correlationId == null ? null : short(correlationId, 128),
      eventId: eventId ?? null,
    });
    return entry;
  }
  const wrapped = {
    fetch: scope.fetch,
    WebSocket: scope.WebSocket,
    XMLHttpRequest: scope.XMLHttpRequest,
  };
  const capture = {
    store,
    annotateMessage,
    disconnect() {
      if (!connected) return;
      connected = false;
      for (const key of Object.keys(wrapped))
        if (scope[key] === wrapped[key])
          scope[key] = {
            fetch: originalFetch,
            WebSocket: OriginalSocket,
            XMLHttpRequest: OriginalXHR,
          }[key];
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      for (const stop of activeReaders) stop();
      activeReaders.clear();
      observer?.disconnect();
      installations.delete(scope);
    },
  };
  installations.set(scope, capture);
  return capture;
}
