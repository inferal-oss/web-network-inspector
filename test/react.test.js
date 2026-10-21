import test from "node:test";
import assert from "node:assert/strict";
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { parseHTML } from "linkedom";
import { NetworkInspector } from "../src/react.js";
import { NetworkCapture, byHostnames } from "../src/index.js";

test("React entry renders on the server without touching a browser", () => {
  assert.equal(
    renderToString(
      React.createElement(NetworkInspector, { open: true, className: "tools" }),
    ),
    '<div class="tools"></div>',
  );
});
async function fixture(run) {
  const { window, document } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  const oldWindow = globalThis.window,
    oldDocument = globalThis.document,
    oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const scope = {
    document,
    innerHeight: 900,
    fetch: async () => new Response("ok"),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  const native = scope.fetch;
  const root = createRoot(document.getElementById("app"));
  try {
    await run({ root, scope, document, native });
  } finally {
    await act(async () => root.unmount());
    assert.equal(scope.fetch, native);
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  }
}
test("Strict Mode cleans capture between mounts, exposes refs, and restores native transports on unmount", () =>
  fixture(async ({ root, scope, document, native }) => {
    const ref = createRef();
    let ready = 0,
      cleanup = 0;
    await act(async () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(NetworkInspector, {
            scope,
            ref,
            open: true,
            onReady: () => {
              ready++;
              return () => cleanup++;
            },
          }),
        ),
      ),
    );
    assert.equal(ready, 2);
    assert.equal(cleanup, 1);
    assert.ok(ref.current);
    assert.notEqual(scope.fetch, native);
    assert.equal(
      document.querySelectorAll("[data-web-network-inspector]").length,
      1,
    );
    ref.current.recordEvent({ label: "React click" });
    assert.equal(ref.current.store.entries.at(-1).label, "React click");
    await act(async () => root.render(null));
    assert.equal(ref.current, null);
    assert.equal(cleanup, 2);
    assert.equal(scope.fetch, native);
    assert.equal(
      document.querySelectorAll("[data-web-network-inspector]").length,
      0,
    );
  }));
test("ordinary rerenders keep history and apply open and container props; capture option changes replace the instance", () =>
  fixture(async ({ root, scope, document }) => {
    const ref = createRef();
    const filter = byHostnames("app.test");
    let ready = 0;
    const render = (props) =>
      root.render(
        React.createElement(NetworkInspector, {
          scope,
          ref,
          filter,
          onReady: () => ready++,
          ...props,
        }),
      );
    await act(async () => render({ open: false, className: "one" }));
    const first = ref.current;
    first.recordEvent({ label: "Keep this" });
    await act(async () => render({ open: true, className: "two" }));
    assert.equal(ref.current, first);
    assert.equal(ready, 1);
    assert.equal(first.store.entries.length, 1);
    assert.equal(first.root.getElementById("network-body").hidden, false);
    assert.ok(document.querySelector(".two [data-web-network-inspector]"));
    await act(async () => render({ capture: false }));
    assert.notEqual(ref.current, first);
    assert.equal(first.host.isConnected, false);
    assert.equal(ready, 2);
  }));
test("shared external stores survive component unmount", () =>
  fixture(async ({ root, scope }) => {
    const store = new NetworkCapture();
    store.recordEvent({ label: "Shared history" });
    const ref = createRef();
    await act(async () =>
      root.render(
        React.createElement(NetworkInspector, {
          scope,
          store,
          capture: false,
          ref,
        }),
      ),
    );
    assert.equal(ref.current.store, store);
    await act(async () => root.render(null));
    assert.equal(store.entries.length, 1);
    assert.equal(ref.current, null);
  }));
