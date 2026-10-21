import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createDetailView } from "../src/detail-renderer.js";
import { NetworkCapture } from "../src/network-capture.js";

test("custom renderer cleanup runs on replacement and destruction, including throwing cleanup", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const store = new NetworkCapture();
  let cleanups = 0;
  const view = createDetailView(document.body, {
    root: { ownerDocument: document },
    store,
    detailFrame: false,
    renderDetails: ({ container, document, entry }) => {
      const node = document.createElement("p");
      node.textContent = entry.label;
      container.append(node);
      return () => {
        cleanups++;
        throw new Error("cleanup failed");
      };
    },
  });
  view.render({ label: "first" }, 1);
  view.render({ label: "second" }, 2);
  assert.equal(cleanups, 1);
  assert.equal(document.body.textContent, "second");
  view.destroy();
  view.destroy();
  assert.equal(cleanups, 2);
});
test("a custom renderer error produces visible text instead of interrupting capture", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const view = createDetailView(document.body, {
    root: { ownerDocument: document },
    store: new NetworkCapture(),
    detailFrame: false,
    renderDetails: () => {
      throw new Error("renderer unavailable");
    },
  });
  view.render(null, null);
  assert.match(
    document.body.textContent,
    /Details renderer failed: renderer unavailable/,
  );
  view.destroy();
});

test("changing the details renderer cleans up the old view and redraws the same selection", () => {
  const { document } = parseHTML("<html><body></body></html>");
  let cleanups = 0;
  const view = createDetailView(document.body, {
    root: { ownerDocument: document },
    store: new NetworkCapture(),
    detailFrame: false,
    renderDetails: ({ container }) => {
      container.textContent = "Custom";
      return () => cleanups++;
    },
  });
  view.render(null, null);
  assert.throws(() => view.setRenderer(false), /function/);
  assert.equal(document.body.textContent, "Custom");
  view.setRenderer();
  assert.equal(cleanups, 1);
  assert.match(document.body.textContent, /Select a request/);
  view.setRenderer(({ container }) => {
    container.textContent = "Another";
    return () => cleanups++;
  });
  assert.equal(document.body.textContent, "Another");
  view.destroy();
  assert.equal(cleanups, 2);
});
