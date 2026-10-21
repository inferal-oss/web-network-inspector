import test from "node:test";
import assert from "node:assert/strict";
import {
  NetworkCapture,
  bodyPreview,
  previewText,
  installNetworkCapture,
} from "../src/network-capture.js";
import { timelinePosition } from "../src/network-activity.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  assert.fail("Capture did not settle");
}
class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  sent = [];
  constructor(url) {
    super();
    this.url = String(url);
  }
  dispatchEvent(event) {
    super.dispatchEvent(event);
    this[`on${event.type}`]?.(event);
    return true;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(data) {
    if (this.readyState !== 1) throw new Error("Not open");
    this.sent.push(data);
  }
  message(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  close() {
    this.readyState = 3;
    const event = new Event("close");
    event.code = 1000;
    event.reason = "done";
    this.dispatchEvent(event);
  }
}
function scope(fetch = async () => new Response("ok")) {
  return { fetch, WebSocket: Socket, location: { href: "http://localhost/" } };
}

test("text previews bound encoded bytes without splitting UTF-8, including non-BMP characters", () => {
  const preview = bodyPreview("a😀éxyz", 6);
  assert.equal(preview.size, 10);
  assert.equal(preview.bytes.length, 5);
  assert.equal(previewText(preview), "a😀");
  assert.equal(preview.truncated, true);
  assert.equal(bodyPreview("\ud800", 3).size, 3);
  assert.equal(bodyPreview("😀", 4).size, 4);
});
test("binary previews copy only the visible bytes from an offset view and render hex", () => {
  const original = new Uint8Array([255, 0, 1, 65, 126, 127, 255]),
    preview = bodyPreview(original.subarray(1), 4);
  original.fill(9);
  assert.deepEqual([...preview.bytes], [0, 1, 65, 126]);
  assert.equal(preview.size, 6);
  assert.equal(preview.truncated, true);
  assert.match(previewText(preview), /000000  00 01 41 7e.*\.\.A~/);
  assert.equal(bodyPreview(new Uint8Array([65]), 4, "text/plain").text, true);
});
test("history expires oldest previews under a global budget, then expires whole entries", () => {
  const store = new NetworkCapture({ limits: { bytes: 6, entries: 2 } });
  const first = store.add({ kind: "http" }),
    second = store.add({ kind: "http" });
  store.preview(first, "requestBody", bodyPreview("abcd"));
  store.preview(second, "responseBody", bodyPreview("efgh"));
  assert.equal(store.bytes, 4);
  assert.equal(store.expiredPreviews, 1);
  assert.match(previewText(first.requestBody), /expired/);
  store.add({ kind: "event", label: "Run" });
  assert.equal(store.entries.length, 2);
  assert.equal(store.expired, 1);
  assert.equal(store.has(first), false);
  store.preview(first, "responseBody", bodyPreview("late"));
  assert.equal(store.bytes, 4);
  store.clear();
  assert.equal(store.bytes, 0);
  assert.equal(store.entries.length, 0);
  assert.equal(
    second.responseBody.bytes.length,
    0,
    "cleared entries held by in-flight callbacks must release preview bytes",
  );
});
test("per-socket message retention and total entry retention remain independent", () => {
  const store = new NetworkCapture({ limits: { messages: 2, entries: 5 } });
  const a = store.add({ kind: "message", connection: 1 });
  store.preview(a, "body", bodyPreview("old"));
  store.add({ kind: "message", connection: 2 });
  store.add({ kind: "event", label: "Run" });
  store.add({ kind: "message", connection: 1 });
  store.add({ kind: "message", connection: 1 });
  assert.equal(store.has(a), false);
  assert.equal(a.body.bytes.length, 0);
  assert.equal(store.expired, 1);
  assert.equal(store.entries.filter((e) => e.connection === 1).length, 2);
  assert.equal(store.entries.length, 4);
});
test("live retention changes trim each socket and entry count immediately, including while paused", () => {
  const store = new NetworkCapture();
  for (let i = 0; i < 8; i++) store.add({ kind: "message", connection: i % 2 });
  store.paused = true;
  store.setLimits({ messages: 2 });
  assert.deepEqual(
    store.entries.map((e) => e.id),
    [5, 6, 7, 8],
  );
  store.setLimits({ entries: 3 });
  assert.deepEqual(
    store.entries.map((e) => e.id),
    [6, 7, 8],
  );
  assert.equal(store.expired, 5);
  store.setLimits({ entries: 10, messages: 10 });
  assert.deepEqual(
    store.entries.map((e) => e.id),
    [6, 7, 8],
  );
  store.clear();
  assert.equal(store.limits.entries, 10);
  assert.equal(new NetworkCapture().limits.entries, 5000);
});
test("retention updates trim existing and delayed previews and never restore discarded bytes", () => {
  const store = new NetworkCapture(),
    first = store.add({ kind: "http" }),
    second = store.add({ kind: "message", connection: 1 });
  store.preview(first, "requestBody", bodyPreview("a😀long"));
  store.preview(second, "body", bodyPreview("123456789"));
  store.setLimits({ preview: 4 });
  assert.equal(previewText(first.requestBody), "a");
  assert.equal(previewText(second.body), "1234");
  assert.equal(store.bytes, 5);
  assert.equal(first.requestBody.truncated, true);
  assert.equal(first.requestBody.size, 9);
  store.setLimits({ bytes: 4 });
  assert.equal(first.requestBody.expired, true);
  assert.equal(store.bytes, 4);
  store.preview(second, "body", bodyPreview("delayed preview"));
  assert.equal(second.body.bytes.length, 4);
  assert.ok(store.bytes <= 4);
  store.setLimits({ preview: 32, bytes: 64 });
  assert.equal(first.requestBody.bytes.length, 0);
  assert.equal(second.body.bytes.length, 4);
});
test("invalid retention updates fail atomically without discarding history", () => {
  const store = new NetworkCapture();
  store.add({ kind: "message" });
  const limits = { ...store.limits };
  for (const changes of [
    { entries: 1, messages: 0 },
    { bytes: Infinity },
    { entries: 1.1 },
    { preview: -1 },
    { messages: 100001 },
    { readers: 2 },
  ]) {
    assert.throws(() => store.setLimits(changes), RangeError);
    assert.deepEqual(store.limits, limits);
    assert.equal(store.entries.length, 1);
  }
});
test("lowering preview limits during an HTTP stream bounds delayed data without changing the response", async () => {
  let controller;
  const original = new Response(
    new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(new TextEncoder().encode("abc"));
      },
    }),
    { headers: { "content-type": "text/plain" } },
  );
  const host = scope(async () => original),
    store = new NetworkCapture({ limits: { preview: 16 } });
  installNetworkCapture(host, store);
  const response = await host.fetch("/stream");
  await settle();
  store.setLimits({ preview: 2 });
  controller.enqueue(new TextEncoder().encode("defgh"));
  controller.close();
  assert.equal(await response.text(), "abcdefgh");
  await until(() => store.entries[0].responseBody);
  assert.equal(previewText(store.entries[0].responseBody), "ab");
  assert.equal(store.entries[0].responseBody.truncated, true);
  assert.equal(store.bytes, 2);
});
test("lowering preview limits during a Blob read preserves truncation metadata", async () => {
  const host = scope(),
    { store } = installNetworkCapture(host),
    socket = new host.WebSocket("ws://localhost/messages");
  socket.open();
  socket.message(new Blob(["abcdef"], { type: "text/plain" }));
  store.setLimits({ preview: 2 });
  await until(() => store.entries.at(-1).body);
  const preview = store.entries.at(-1).body;
  assert.equal(previewText(preview), "ab");
  assert.equal(preview.size, 6);
  assert.equal(preview.truncated, true);
});
test("pause skips new entries and previews; each new recorder starts empty", () => {
  const store = new NetworkCapture(),
    entry = store.add({ kind: "http" });
  store.paused = true;
  assert.equal(store.add({ kind: "message" }), null);
  store.preview(entry, "body", bodyPreview("skip"));
  assert.equal(store.bytes, 0);
  store.paused = false;
  store.add({ kind: "message" });
  assert.equal(store.entries.length, 2);
  assert.equal(new NetworkCapture().entries.length, 0);
});
test("fetch returns the original response with full readable content and caps both previews", async () => {
  const original = new Response("abcdefghijklmnop", {
    headers: { "content-type": "text/plain", "content-length": "16" },
  });
  let received;
  const host = scope(async (input, init) => {
      received = { input, init };
      return original;
    }),
    store = new NetworkCapture({ limits: { preview: 4 } });
  installNetworkCapture(host, store);
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"large":"data"}',
  };
  const response = await host.fetch("/echo", init);
  assert.equal(response, original);
  assert.equal(received.init, init);
  assert.equal(await response.text(), "abcdefghijklmnop");
  await until(() => store.entries[0].responseBody);
  const entry = store.entries[0];
  assert.equal(entry.method, "POST");
  assert.equal(entry.url, "http://localhost/echo");
  assert.equal(previewText(entry.requestBody), '{"la');
  assert.equal(previewText(entry.responseBody), "abcd");
  assert.equal(entry.responseBody.size, 16);
  assert.equal(entry.responseBody.truncated, true);
  assert.equal(store.bytes, 8);
});
test("streaming preview stops at the prefix without waiting for the entire response", async () => {
  let streamController;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode("first chunk"));
      },
    }),
    { headers: { "content-type": "text/plain" } },
  );
  const host = scope(async () => response),
    store = new NetworkCapture({ limits: { preview: 5 } });
  installNetworkCapture(host, store);
  const returned = await host.fetch("/stream");
  await until(() => store.entries[0].responseBody);
  assert.equal(previewText(store.entries[0].responseBody), "first");
  assert.equal(store.entries[0].responseBody.size, null);
  streamController.enqueue(new TextEncoder().encode(" final"));
  streamController.close();
  assert.equal(await returned.text(), "first chunk final");
});
test("streaming request bodies are never consumed or cloned by recording", async () => {
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([65]));
        c.close();
      },
    }),
    duplex: "half",
  });
  const host = scope(async (input) => {
    assert.equal(input, request);
    assert.equal(input.bodyUsed, false);
    assert.equal(await input.text(), "A");
    return new Response(null, { status: 204 });
  });
  const { store } = installNetworkCapture(host);
  await host.fetch(request);
  assert.match(store.entries[0].requestBody.note, /not read/);
  assert.equal(store.entries[0].status, 204);
});
test("fetch failures keep the original rejection and record cancellation", async () => {
  const error = new DOMException("cancelled", "AbortError"),
    host = scope(async () => {
      throw error;
    });
  const { store } = installNetworkCapture(host);
  await assert.rejects(host.fetch("/abort"), (value) => value === error);
  assert.equal(store.entries[0].status, "Cancelled");
  assert.ok(store.entries[0].end >= store.entries[0].start);
});
test("reader concurrency is bounded and clearing rejects delayed preview writes", async () => {
  const streams = [];
  const host = scope(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            streams.push(c);
          },
        }),
      ),
  );
  const store = new NetworkCapture({ limits: { readers: 1 } });
  installNetworkCapture(host, store);
  const first = await host.fetch("/one"),
    second = await host.fetch("/two");
  assert.match(store.entries[1].responseBody.note, /readers busy/);
  store.clear();
  streams[0].enqueue(new Uint8Array([1, 2]));
  streams[0].close();
  streams[1].close();
  await first.arrayBuffer();
  await second.arrayBuffer();
  await settle();
  assert.equal(store.bytes, 0);
  assert.equal(store.entries.length, 0);
});
test("native WebSocket semantics, binary messages, failed sends, and close metadata survive wrapping", async () => {
  const host = scope(),
    { store } = installNetworkCapture(host),
    socket = new host.WebSocket("ws://localhost/messages");
  assert.ok(socket instanceof Socket);
  assert.ok(socket instanceof host.WebSocket);
  assert.equal(host.WebSocket.OPEN, 1);
  assert.throws(() => socket.send("not sent"), /Not open/);
  assert.equal(store.entries.length, 1);
  socket.open();
  let delivered;
  socket.onmessage = (event) => {
    delivered = event.data;
  };
  const data = new Uint8Array([0, 255]);
  socket.send("hello");
  socket.message(data);
  assert.equal(delivered, data);
  assert.equal(socket.sent[0], "hello");
  const messages = store.entries.filter((e) => e.kind === "message");
  assert.deepEqual(
    messages.map((e) => e.direction),
    ["out", "in"],
  );
  assert.deepEqual([...messages[1].body.bytes], [0, 255]);
  socket.message(new Blob(["binary"]));
  await until(() => store.entries.at(-1).body);
  assert.equal(store.entries.at(-1).body.size, 6);
  socket.close();
  assert.equal(store.entries[0].status, "Closed");
  assert.equal(store.entries[0].closeCode, 1000);
  const closed = store.entries.at(-1);
  assert.equal(closed.label, "WebSocket disconnected");
  assert.equal(closed.connection, store.entries[0].id);
  assert.equal(closed.closeCode, 1000);
  assert.equal(closed.closeReason, "done");
  assert.equal(closed.start, closed.end);
});

test("resource previews use a separate bounded GET without changing original timing or duplicating capture", async () => {
  let calls = 0;
  const host = scope(async (_url, init) => {
    calls++;
    assert.equal(init.cache, "force-cache");
    assert.equal(init.credentials, "same-origin");
    return new Response("resource content", {
      headers: { "content-type": "text/css", "x-demo": "preview" },
    });
  });
  const store = new NetworkCapture({ limits: { preview: 8 } });
  const capture = installNetworkCapture(host, store);
  const entry = store.add({
    kind: "resource",
    method: "GET",
    url: "http://localhost/app.css",
    start: 1,
    end: 2,
    status: "Loaded",
  });
  await capture.loadResource(entry);
  assert.equal(calls, 1);
  assert.equal(store.entries.length, 1);
  assert.equal(entry.start, 1);
  assert.equal(entry.end, 2);
  assert.match(entry.resourceResponseHeaders, /x-demo: preview/);
  assert.equal(entry.resourceBody.contentType, "text/css");
  assert.equal(previewText(entry.resourceBody), "resource");
  assert.equal(entry.resourceBody.truncated, true);
  store.setLimits({ preview: 4 });
  assert.equal(entry.resourceBody.bytes.length, 4);
  store.clear();
  assert.equal(store.bytes, 0);
  await assert.rejects(capture.loadResource(entry), /retained/);
  capture.disconnect();
});
test("resume recording on an already-open socket and capture subsequent messages after clear", () => {
  const host = scope(),
    { store } = installNetworkCapture(host);
  store.paused = true;
  const socket = new host.WebSocket("ws://localhost/messages");
  socket.open();
  socket.send("skipped");
  assert.equal(store.entries.length, 0);
  store.paused = false;
  socket.send("recorded");
  assert.deepEqual(
    store.entries.map((e) => e.kind),
    ["socket", "message"],
  );
  store.clear();
  socket.message("new history");
  assert.deepEqual(
    store.entries.map((e) => e.kind),
    ["socket", "message"],
  );
  socket.close();
});
test("expiring connection metadata cannot reset the per-socket message limit", () => {
  const host = scope(),
    store = new NetworkCapture({ limits: { entries: 4, messages: 2 } });
  installNetworkCapture(host, store);
  const socket = new host.WebSocket("ws://localhost/messages");
  socket.open();
  const id = store.entries[0].id;
  store.add({ kind: "event", label: "Other event" });
  socket.message("one");
  store.add({ kind: "event", label: "Other event" });
  socket.message("two");
  assert.equal(store.byId.has(id), false);
  socket.message("three");
  const messages = store.entries.filter((e) => e.kind === "message");
  assert.equal(messages.length, 2);
  assert.deepEqual(
    messages.map((e) => e.connection),
    [id, id],
  );
  assert.deepEqual(
    messages.map((e) => previewText(e.body)),
    ["two", "three"],
  );
  socket.close();
});
test("waterfall uses one time scale for overlapping requests and point markers", () => {
  assert.deepEqual(timelinePosition({ start: 20, end: 60 }, 0, 100, 100), {
    left: 20,
    width: 40,
  });
  assert.deepEqual(timelinePosition({ start: 40 }, 0, 100, 80), {
    left: 40,
    width: 40,
  });
  assert.deepEqual(timelinePosition({ start: 50, end: 50 }, 0, 100, 100), {
    left: 50,
    width: 0,
  });
});
test("XHR captures bounded request and response previews while preserving native arguments", () => {
  class XHR extends EventTarget {
    open(...args) {
      this.opened = args;
    }
    setRequestHeader(...args) {
      this.header = args;
    }
    send(body) {
      this.sent = body;
    }
    getAllResponseHeaders() {
      return "content-type: application/octet-stream\r\n";
    }
    getResponseHeader() {
      return "application/octet-stream";
    }
  }
  const host = { ...scope(), XMLHttpRequest: XHR },
    store = new NetworkCapture({ limits: { preview: 3 } });
  installNetworkCapture(host, store);
  const xhr = new host.XMLHttpRequest();
  assert.ok(xhr instanceof XHR);
  xhr.open("POST", "/upload", true);
  xhr.setRequestHeader("test", "value");
  xhr.send("payload");
  assert.deepEqual(xhr.opened, ["POST", "/upload", true]);
  assert.equal(xhr.sent, "payload");
  assert.deepEqual(xhr.header, ["test", "value"]);
  xhr.status = 201;
  xhr.response = new Uint8Array([0, 1, 2, 3]).buffer;
  xhr.dispatchEvent(new Event("loadend"));
  const entry = store.entries[0];
  assert.equal(entry.status, 201);
  assert.equal(entry.transport, "XHR");
  assert.equal(entry.requestBody.size, 7);
  assert.equal(previewText(entry.requestBody), "pay");
  assert.deepEqual([...entry.responseBody.bytes], [0, 1, 2]);
  assert.equal(entry.responseBody.truncated, true);
});
test("browser resource observations add metadata and finish fetch timing without duplicate entries", async () => {
  let notify,
    disconnected = false;
  class Observer {
    constructor(callback) {
      notify = callback;
    }
    observe(options) {
      assert.deepEqual(options, { type: "resource", buffered: true });
    }
    disconnect() {
      disconnected = true;
    }
  }
  let now = 10;
  const host = {
      ...scope(async () => new Response(null, { status: 204 })),
      PerformanceObserver: Observer,
    },
    store = new NetworkCapture({ now: () => now });
  const capture = installNetworkCapture(host, store);
  await host.fetch("/request");
  now = 20;
  store.add({ kind: "event", label: "A later click" });
  notify({
    getEntries: () => [
      {
        initiatorType: "fetch",
        name: "http://localhost/request",
        startTime: 10,
        responseEnd: 18,
        transferSize: 300,
      },
      {
        initiatorType: "script",
        name: "http://localhost/app.js",
        startTime: 1,
        responseEnd: 5,
        transferSize: 1000,
      },
    ],
  });
  assert.equal(store.entries.length, 3);
  assert.equal(store.entries[0].end, 18);
  assert.equal(store.entries[0].transferSize, 300);
  assert.equal(store.entries[2].kind, "resource");
  assert.equal(store.entries[2].nearEvent, null);
  assert.equal(store.entries[2].body, undefined);
  const originalFetch = host.fetch;
  capture.disconnect();
  assert.notEqual(host.fetch, originalFetch);
  assert.equal(host.WebSocket, Socket);
  assert.equal(disconnected, true);
});
test("recording failures never change the fetch result or rejection", async () => {
  const response = new Response(null, { status: 204 }),
    host = scope(async () => response),
    store = new NetworkCapture();
  store.listeners.add(() => {
    throw new Error("inspector failure");
  });
  installNetworkCapture(host, store);
  assert.equal(await host.fetch("/unchanged"), response);
});
test("concurrent requests to the same URL retain separate browser timings", async () => {
  let notify,
    now = 10;
  class Observer {
    constructor(callback) {
      notify = callback;
    }
    observe() {}
    disconnect() {}
  }
  const host = {
      ...scope(async () => new Response(null, { status: 204 })),
      PerformanceObserver: Observer,
    },
    store = new NetworkCapture({ now: () => now });
  installNetworkCapture(host, store);
  await host.fetch("/same");
  now = 12;
  await host.fetch("/same");
  notify({
    getEntries: () => [
      {
        initiatorType: "fetch",
        name: "http://localhost/same",
        startTime: 10,
        responseStart: 15,
        responseEnd: 18,
        transferSize: 100,
      },
      {
        initiatorType: "fetch",
        name: "http://localhost/same",
        startTime: 12,
        responseStart: 16,
        responseEnd: 30,
        transferSize: 200,
      },
    ],
  });
  assert.deepEqual(
    store.entries.map((e) => [e.start, e.headersAt, e.end, e.transferSize]),
    [
      [10, 15, 18, 100],
      [12, 16, 30, 200],
    ],
  );
});
test("a failed XHR send cannot leave a recorder attached to a later request", () => {
  class XHR extends EventTarget {
    open() {}
    setRequestHeader() {}
    send(body) {
      if (body === "fail") throw new Error("Native send failure");
    }
    getAllResponseHeaders() {
      return "";
    }
    getResponseHeader() {
      return "text/plain";
    }
  }
  const host = { ...scope(), XMLHttpRequest: XHR },
    { store } = installNetworkCapture(host),
    xhr = new host.XMLHttpRequest();
  xhr.open("POST", "/first");
  assert.throws(() => xhr.send("fail"), /Native send failure/);
  xhr.open("GET", "/second");
  xhr.send(null);
  xhr.status = 200;
  xhr.response = "success";
  xhr.dispatchEvent(new Event("loadend"));
  assert.equal(store.entries[0].status, "Failed");
  assert.equal(store.entries[0].responseBody, undefined);
  assert.equal(store.entries[1].status, 200);
  assert.equal(previewText(store.entries[1].responseBody), "success");
});

test("generic events bound payloads, preserve caller types, and link explicit parent events", () => {
  const store = new NetworkCapture({ limits: { preview: 8 } }),
    seen = [];
  const unsubscribe = store.subscribe(() => seen.push(store.entries.length));
  const first = store.recordEvent({
    type: "cart.changed",
    label: "Cart changed",
    correlationId: "cart-123",
    data: "0123456789",
  });
  const next = store.recordEvent({ type: "payment.ready", parentId: first.id });
  assert.equal(first.eventType, "cart.changed");
  assert.equal(first.correlationId, "cart-123");
  assert.equal(previewText(first.body), "01234567");
  assert.equal(first.body.truncated, true);
  assert.equal(next.eventId, first.id);
  unsubscribe();
  const length = seen.length;
  store.clear();
  assert.equal(seen.length, length);
  assert.equal(
    store.recordEvent({ type: "other", parentId: null }).eventId,
    null,
  );
});
test("generic message annotation adds caller metadata without parsing or retaining protocol objects", () => {
  const host = scope(),
    capture = installNetworkCapture(host),
    socket = new host.WebSocket("ws://localhost/messages");
  socket.open();
  socket.send("arbitrary bytes");
  const entry = capture.annotateMessage(socket, "out", {
    type: "chat.post",
    label: "Sent greeting",
    correlationId: "room-a",
    eventId: 42,
  });
  assert.equal(entry.protocol, "chat.post");
  assert.equal(entry.eventId, 42);
  assert.equal(entry.correlationId, "room-a");
  assert.equal(entry.label, "Sent greeting");
  assert.throws(() => capture.annotateMessage(socket, "wrong", {}), TypeError);
  capture.store.clear();
  assert.equal(capture.annotateMessage(socket, "out", { type: "old" }), null);
  capture.disconnect();
});
test("disconnect removes socket recording and restores transports without replacing later wrappers", async () => {
  const host = scope(),
    fetch = host.fetch,
    capture = installNetworkCapture(host),
    socket = new host.WebSocket("ws://localhost/messages");
  socket.open();
  const nativeSend = Socket.prototype.send;
  assert.notEqual(socket.send, nativeSend);
  assert.throws(() => installNetworkCapture(host), /already installed/);
  const count = capture.store.entries.length;
  capture.disconnect();
  capture.disconnect();
  assert.equal(host.fetch, fetch);
  assert.equal(socket.send, nativeSend);
  socket.send("after");
  socket.message("after");
  socket.close();
  assert.equal(capture.store.entries.length, count);
  const next = installNetworkCapture(host),
    later = async () => new Response("later");
  host.fetch = later;
  next.disconnect();
  assert.equal(host.fetch, later);
});
test("disconnect during a pending fetch preserves the response and prevents later recording", async () => {
  let resolve;
  const host = scope(() => new Promise((done) => (resolve = done))),
    capture = installNetworkCapture(host);
  const pending = host.fetch("/pending");
  capture.disconnect();
  const original = new Response("complete");
  resolve(original);
  assert.equal(await pending, original);
  assert.equal(await original.text(), "complete");
  assert.equal(capture.store.entries[0].responseBody, undefined);
});
test("constructor validates retention and reader limits before capture starts", () => {
  for (const limits of [
    { entries: 0 },
    { preview: Infinity },
    { messages: -1 },
    { readers: 0 },
    { readers: 65 },
  ])
    assert.throws(() => new NetworkCapture({ limits }), RangeError);
});

test("fetch preserves one-shot headers and inherited options without mutating a frozen init", async () => {
  let received;
  const host = scope(async (input, init) => {
    received = {
      input,
      method: init.method,
      body: init.body,
      headers: [...new Headers(init.headers)],
      signal: init.signal,
    };
    return new Response(null, { status: 204 });
  });
  const capture = installNetworkCapture(host);
  let iterations = 0;
  const headers = (function* () {
    iterations++;
    yield ["x-demo", "present"];
    yield ["content-type", "application/json"];
  })();
  const controller = new AbortController();
  const init = Object.freeze(
    Object.create(
      { method: "POST" },
      {
        headers: { value: headers, enumerable: true },
        signal: { value: controller.signal, enumerable: true },
        body: {
          get() {
            assert.equal(this, init);
            return '{"message":"hello"}';
          },
          enumerable: true,
        },
      },
    ),
  );
  try {
    await host.fetch("/echo", init);
    assert.deepEqual(received, {
      input: "/echo",
      method: "POST",
      body: '{"message":"hello"}',
      headers: [
        ["content-type", "application/json"],
        ["x-demo", "present"],
      ],
      signal: controller.signal,
    });
    assert.equal(iterations, 1);
    assert.equal(init.headers, headers);
    assert.match(capture.store.entries[0].requestHeaders, /x-demo: present/);
    assert.match(
      capture.store.entries[0].requestHeaders,
      /content-type: application\/json/,
    );
    assert.equal(
      previewText(capture.store.entries[0].requestBody),
      '{"message":"hello"}',
    );
  } finally {
    capture.disconnect();
  }
});

test("invalid iterable headers reject without sending a partially consumed request", async () => {
  let sent = false;
  const host = scope(async (_input, init) => {
    new Headers(init.headers);
    sent = true;
    return new Response(null, { status: 204 });
  });
  const capture = installNetworkCapture(host);
  const error = new Error("Header iterator failed");
  const headers = (function* () {
    yield ["x-demo", "present"];
    throw error;
  })();
  try {
    await assert.rejects(
      host.fetch("/echo", { headers }),
      (value) => value === error,
    );
    assert.equal(sent, false);
  } finally {
    capture.disconnect();
  }
});
