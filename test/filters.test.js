import test from "node:test";
import assert from "node:assert/strict";
import {
  NetworkCapture,
  installNetworkCapture,
  createInspector,
  byHostnames,
  byOrigins,
  byMethods,
  allOf,
  anyOf,
  not,
} from "../src/index.js";
import { parseHTML } from "linkedom";
const metadata = (url) => {
  const parsed = new URL(url);
  return {
    url,
    hostname: parsed.hostname,
    origin: parsed.origin,
    method: "GET",
  };
};
test("hostname factories match normalized exact names and explicit subdomains without suffix confusion", () => {
  const exact = byHostnames(["EXAMPLE.com.", "bücher.example", "[::1]"]);
  for (const url of [
    "https://example.com:8443/a",
    "wss://example.com/",
    "https://example.com./",
    "https://xn--bcher-kva.example/",
    "http://[::1]/",
  ])
    assert.equal(exact(metadata(url)), true, url);
  for (const url of [
    "https://api.example.com/",
    "https://example.com.attacker.test/",
    "https://notexample.com/",
  ])
    assert.equal(exact(metadata(url)), false, url);
  const sub = byHostnames("example.com", { includeSubdomains: true });
  assert.equal(sub(metadata("https://api.example.com/")), true);
  assert.equal(sub(metadata("https://badexample.com/")), false);
  assert.equal(sub({ hostname: null }), false);
  assert.equal(byHostnames([])(metadata("https://example.com/")), false);
  for (const host of [
    "https://example.com",
    "example.com:443",
    "example.com:80",
    "[::1]:80",
    "example.com/path",
    "a@b.test",
  ])
    assert.throws(() => byHostnames([host]));
});
test("origin, method, and composed filters retain scheme and port boundaries", () => {
  const filter = allOf(
    byOrigins(["https://example.com", "https://example.com:8443"]),
    byMethods(["get", "HEAD"]),
    not(byHostnames(["ignore.test"])),
  );
  assert.equal(filter(metadata("https://example.com:443/")), true);
  assert.equal(filter(metadata("http://example.com/")), false);
  assert.equal(filter(metadata("https://example.com:8443/")), true);
  assert.equal(filter(metadata("https://example.com:8080/")), false);
  assert.equal(
    filter({ ...metadata("https://example.com/"), method: "POST" }),
    false,
  );
  assert.equal(
    anyOf(
      filter,
      byOrigins("wss://example.com"),
    )(metadata("wss://example.com/")),
    true,
  );
  assert.equal(allOf()({}), true);
  assert.equal(anyOf()({}), false);
  for (const origin of [
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?q=a",
    "data:text/plain,abc",
  ])
    assert.throws(() => byOrigins([origin]));
  assert.throws(() => byMethods(["GET\nPOST"]));
  assert.throws(() => not(null));
  assert.throws(() => allOf(true));
});
test("rejected fetches retain no entries, previews, or notifications and preserve native outcomes", async () => {
  let clones = 0,
    calls = 0,
    notices = 0;
  const response = new Response("private response");
  response.clone = () => {
    clones++;
    throw Error("must not clone");
  };
  const scope = {
    location: { href: "https://app.test/" },
    fetch: async () => {
      calls++;
      return response;
    },
  };
  const store = new NetworkCapture({ filter: byHostnames("api.test") });
  store.subscribe(() => notices++);
  const capture = installNetworkCapture(scope, store);
  try {
    assert.equal(
      await scope.fetch("https://excluded.test/private", {
        method: "POST",
        body: "private request",
      }),
      response,
    );
    assert.equal(calls, 1);
    assert.equal(clones, 0);
    assert.deepEqual(store.entries, []);
    assert.equal(store.bytes, 0);
    assert.equal(notices, 0);
    assert.equal(store.serial, 0);
    assert.equal(await response.text(), "private response");
    const event = store.recordEvent({ label: "User clicked" });
    assert.equal(event.kind, "event");
  } finally {
    capture.disconnect();
  }
});
test("predicates see frozen metadata without bodies or headers and fail closed without changing requests", async () => {
  let seen;
  const store = new NetworkCapture({
    filter: (m) => {
      seen = m;
      return true;
    },
  });
  const scope = {
    location: { href: "https://app.test/" },
    fetch: async () => new Response("ok"),
  };
  const capture = installNetworkCapture(scope, store);
  try {
    await scope.fetch("/items", {
      method: "POST",
      headers: { "X-Private": "secret" },
      body: "payload",
    });
    assert.equal(Object.isFrozen(seen), true);
    assert.equal(seen.hostname, "app.test");
    assert.equal(seen.method, "POST");
    assert.equal(seen.transport, "fetch");
    assert.equal(seen.url, "https://app.test/items");
    assert.equal("body" in seen, false);
    assert.equal("headers" in seen, false);
  } finally {
    capture.disconnect();
  }
  for (const filter of [
    () => {
      throw Error("predicate failed");
    },
    () => 1,
    () => Promise.resolve(true),
    () => Promise.reject(Error("async failed")),
    not(() => undefined),
    anyOf(() => Promise.resolve(true)),
  ]) {
    const store = new NetworkCapture({ filter });
    const scope = {
      location: { href: "https://app.test/" },
      fetch: async () => new Response("native"),
    };
    const handle = installNetworkCapture(scope, store);
    try {
      assert.equal(await (await scope.fetch("/private")).text(), "native");
      assert.equal(store.entries.length, 0);
    } finally {
      handle.disconnect();
    }
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => new NetworkCapture({ filter: false }), TypeError);
});
test("resource entries and frames are filtered, and rejected connections cannot publish orphan frames", () => {
  class Socket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
    }
    send() {}
  }
  let observerCallback;
  class Observer {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  }
  const store = new NetworkCapture({
    filter: (meta) =>
      meta.kind !== "socket" && byHostnames("allowed.test")(meta),
  });
  const scope = {
    WebSocket: Socket,
    PerformanceObserver: Observer,
    location: { href: "https://app.test/" },
  };
  const capture = installNetworkCapture(scope, store);
  try {
    const socket = new scope.WebSocket("wss://allowed.test/");
    socket.send("hidden");
    socket.dispatchEvent(new MessageEvent("message", { data: "hidden" }));
    assert.equal(store.entries.length, 0);
    observerCallback({
      getEntries: () => [
        {
          name: "https://excluded.test/logo.svg",
          initiatorType: "img",
          startTime: 0,
          responseEnd: 2,
        },
        {
          name: "https://allowed.test/logo.svg",
          initiatorType: "img",
          startTime: 0,
          responseEnd: 2,
        },
      ],
    });
    assert.equal(store.entries.length, 1);
    assert.equal(store.entries[0].kind, "resource");
    assert.equal(store.entries[0].url, "https://allowed.test/logo.svg");
  } finally {
    capture.disconnect();
  }
});
test("createInspector configures an owned filter and rejects conflicting shared-store policy", () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  const scope = {
    document,
    innerHeight: 900,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  const filter = byHostnames("api.test");
  const inspector = createInspector({ scope, capture: false, filter });
  try {
    assert.equal(inspector.store.filter, filter);
    assert.equal(
      inspector.store.add({ kind: "http", url: "https://excluded.test/" }),
      null,
    );
    assert.throws(
      () =>
        createInspector({
          scope,
          capture: false,
          store: inspector.store,
          filter,
        }),
      TypeError,
    );
  } finally {
    inspector.destroy();
  }
});

test("rejected XHR preserves native sending without reading response headers or bodies", () => {
  let reads = 0,
    sent;
  class XHR extends EventTarget {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader() {}
    send(body) {
      sent = body;
      this.dispatchEvent(new Event("loadend"));
      return "native result";
    }
    get response() {
      reads++;
      return "private response";
    }
    getAllResponseHeaders() {
      reads++;
      return "private header";
    }
    getResponseHeader() {
      reads++;
      return "text/plain";
    }
  }
  const scope = {
    XMLHttpRequest: XHR,
    location: { href: "https://app.test/" },
  };
  const store = new NetworkCapture({ filter: () => false });
  const capture = installNetworkCapture(scope, store);
  try {
    const xhr = new scope.XMLHttpRequest();
    xhr.open("POST", "/private");
    assert.equal(xhr.send("original body"), "native result");
    assert.equal(sent, "original body");
    assert.equal(reads, 0);
    assert.equal(store.entries.length, 0);
  } finally {
    capture.disconnect();
  }
});
