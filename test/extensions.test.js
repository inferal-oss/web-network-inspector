import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createInspector, NetworkCapture } from "../src/index.js";
function fixture(run) {
  const { document, window } = parseHTML(
    '<html><body><button id="outside">Outside</button></body></html>',
  );
  const scope = {
    document,
    innerHeight: 900,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  const inspector = createInspector({ scope, capture: false });
  try {
    return run({ inspector, document, window, scope });
  } finally {
    inspector.destroy();
  }
}
test("bar items support custom controls, stable updates, duplicate rejection and removal", () =>
  fixture(({ inspector, document, window }) => {
    let count = 0;
    const button = inspector.addBarItem({
      id: "status",
      label: "Ready",
      onClick: ({ inspector: owner, element }) => {
        assert.equal(owner, inspector);
        assert.equal(element, button.element);
        count++;
      },
    });
    button.element.dispatchEvent(new window.Event("click"));
    assert.equal(count, 1);
    const node = button.element;
    button.update({ label: "Busy", title: "Working", disabled: true });
    assert.equal(button.element, node);
    assert.equal(node.textContent, "Busy");
    assert.equal(node.disabled, true);
    assert.throws(() => inspector.addBarItem({ id: "status" }), TypeError);
    const input = document.createElement("input");
    input.type = "range";
    const custom = inspector.addBarItem({ id: "slider", element: input });
    assert.equal(custom.element, input);
    button.remove();
    button.remove();
    node.dispatchEvent(new window.Event("click"));
    assert.equal(count, 1);
    assert.equal(node.isConnected, false);
    inspector.addBarItem({ id: "status", label: "Replacement" });
    assert.equal(input.isConnected, true);
  }));
test("popups render text safely, update custom content, and run cleanup once per content lifetime", () =>
  fixture(({ inspector, document }) => {
    const item = inspector.addBarItem({ id: "details", label: "Details" });
    let cleanups = 0,
      closed = 0;
    const popup = inspector.openPopup({
      title: "Custom details",
      anchor: item.element,
      content: "<img src=x onerror=boom>",
      onClose: () => closed++,
    });
    assert.equal(popup.element.getAttribute("role"), "dialog");
    assert.equal(popup.element.querySelector("img"), null);
    assert.match(popup.element.textContent, /<img/);
    assert.equal(item.element.getAttribute("aria-expanded"), "true");
    popup.update({
      title: "Updated",
      content: ({ container }) => {
        const node = document.createElement("p");
        node.textContent = "Application content";
        container.append(node);
        return () => cleanups++;
      },
    });
    assert.match(popup.element.textContent, /Updated.*Application content/);
    popup.update({ content: "Next" });
    assert.equal(cleanups, 1);
    popup.close();
    popup.close();
    assert.equal(cleanups, 1);
    assert.equal(closed, 1);
    assert.equal(item.element.getAttribute("aria-expanded"), "false");
  }));
test("popup replacement, anchor removal, and destroy close extension resources", () =>
  fixture(({ inspector }) => {
    let cleaned = 0;
    const item = inspector.addBarItem({ id: "details", label: "Details" });
    const first = inspector.openPopup({ content: () => () => cleaned++ });
    const second = inspector.openPopup({
      anchor: item.element,
      content: "Second",
    });
    assert.equal(first.element.isConnected, false);
    assert.equal(cleaned, 1);
    item.remove();
    assert.equal(second.element.isConnected, false);
    inspector.openPopup({ content: () => () => cleaned++ });
    inspector.destroy();
    inspector.destroy();
    assert.equal(cleaned, 2);
    assert.equal(inspector.host.isConnected, false);
    assert.throws(() => inspector.recordEvent({}), /destroyed/);
    assert.throws(() => inspector.addBarItem({ id: "later" }), /destroyed/);
  }));
test("two views can share a store while their controls and popups remain independent", () =>
  fixture(({ inspector, scope }) => {
    const second = createInspector({
      scope,
      store: inspector.store,
      capture: false,
    });
    try {
      inspector.recordEvent({ type: "custom.signal", label: "A signal" });
      assert.equal(second.store.entries.length, 1);
      assert.notEqual(second.root, inspector.root);
      inspector.addBarItem({ id: "same", label: "First" });
      second.addBarItem({ id: "same", label: "Second" });
      assert.equal(
        second.root.getElementById("network-items").textContent,
        "Second",
      );
      inspector.destroy();
      assert.equal(second.host.isConnected, true);
      assert.equal(second.store.entries.length, 1);
    } finally {
      second.destroy();
    }
  }));
test("store subscriptions report changes and can unsubscribe without changing recording", () =>
  fixture(({ inspector }) => {
    let count = 0;
    const off = inspector.subscribe(() => count++);
    inspector.recordEvent({ type: "anything" });
    assert.equal(count, 1);
    off();
    inspector.recordEvent({ type: "another" });
    assert.equal(count, 1);
    const store = new NetworkCapture();
    store.subscribe(() => {
      throw new Error("consumer error");
    });
    assert.doesNotThrow(() => store.recordEvent({ type: "still-recorded" }));
  }));

test("popup renderers that close synchronously dispose returned resources exactly once", () =>
  fixture(({ inspector }) => {
    let disposed = 0,
      closed = 0;
    const item = inspector.addBarItem({ id: "details", label: "Details" });
    const popup = inspector.openPopup({
      anchor: item.element,
      onClose: () => closed++,
      content: ({ close }) => {
        close();
        return () => disposed++;
      },
    });
    assert.equal(popup.element.isConnected, false);
    assert.equal(item.element.getAttribute("aria-expanded"), "false");
    assert.equal(disposed, 1);
    assert.equal(closed, 1);
    popup.close();
    inspector.destroy();
    assert.equal(disposed, 1);
    assert.equal(closed, 1);
  }));

test("popup updates dispose renderers that close, replace, or destroy their popup while rendering", () =>
  fixture(({ inspector }) => {
    let disposed = 0;
    const popup = inspector.openPopup({ content: () => () => disposed++ });
    popup.update({
      content: ({ close }) => {
        close();
        return () => disposed++;
      },
    });
    assert.equal(disposed, 2);
    let replacement;
    const replaced = inspector.openPopup({
      content: () => {
        replacement = inspector.openPopup({
          title: "Replacement",
          content: "Still open",
        });
        return () => disposed++;
      },
    });
    assert.equal(replaced.element.isConnected, false);
    assert.equal(disposed, 3);
    assert.equal(replacement.element.isConnected, true);
    assert.match(replacement.element.textContent, /Still open/);
    const destroyed = inspector.openPopup({
      content: () => {
        inspector.destroy();
        return () => disposed++;
      },
    });
    assert.equal(destroyed.element.isConnected, false);
    assert.equal(disposed, 4);
  }));

test("content cleanup can close its popup without starting the replacement renderer", () =>
  fixture(({ inspector }) => {
    let popup,
      disposed = 0,
      renders = 0;
    popup = inspector.openPopup({
      content: () => () => {
        disposed++;
        popup.close();
      },
    });
    popup.update({
      content: () => {
        renders++;
        return () => disposed++;
      },
    });
    assert.equal(popup.element.isConnected, false);
    assert.equal(disposed, 1);
    assert.equal(renders, 0);
  }));

test("removing an unrelated expanded control leaves the active popup open", () =>
  fixture(({ inspector, document }) => {
    const disclosure = document.createElement("button");
    disclosure.setAttribute("aria-expanded", "true");
    const unrelated = inspector.addBarItem({
      id: "disclosure",
      element: disclosure,
    });
    const owner = inspector.addBarItem({ id: "owner", label: "Details" });
    let disposed = 0;
    const popup = inspector.openPopup({
      anchor: owner.element,
      content: () => () => disposed++,
    });
    unrelated.remove();
    assert.equal(popup.element.isConnected, true);
    assert.equal(disposed, 0);
    owner.element.setAttribute("aria-expanded", "false");
    owner.remove();
    assert.equal(popup.element.isConnected, false);
    assert.equal(disposed, 1);
  }));

test("removing a custom bar container closes a popup anchored to its child", () =>
  fixture(({ inspector, document }) => {
    const group = document.createElement("div"),
      anchor = document.createElement("button");
    group.append(anchor);
    const item = inspector.addBarItem({ id: "group", element: group });
    let closed = 0;
    const popup = inspector.openPopup({
      anchor,
      content: "Nested details",
      onClose: () => closed++,
    });
    item.remove();
    item.remove();
    assert.equal(popup.element.isConnected, false);
    assert.equal(anchor.getAttribute("aria-expanded"), "false");
    assert.equal(closed, 1);
  }));
