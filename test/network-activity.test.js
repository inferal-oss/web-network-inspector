import test from "node:test";
import assert from "node:assert/strict";
import {
  setupNetworkActivity,
  sortActivity,
  activitySize,
} from "../src/network-activity.js";
import { NetworkCapture, bodyPreview } from "../src/network-capture.js";

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.events = new Map();
    this.attributes = new Map();
    this.className = "";
    this.ownText = "";
    this.textWrites = 0;
    this.value = "";
    this.checked = true;
    this.scrollTop = 0;
    this.dataset = {};
    this.options = [{ value: "" }];
    this.style = { setProperty() {} };
    this.classList = { toggle() {} };
  }
  set textContent(value) {
    this.textWrites++;
    this.replaceChildren();
    this.ownText = String(value);
  }
  get textContent() {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get lastChild() {
    return this.children.at(-1) ?? null;
  }
  get parentElement() {
    return this.parent ?? null;
  }
  get previousElementSibling() {
    return (
      this.parent?.children[this.parent.children.indexOf(this) - 1] ?? null
    );
  }
  get nextSibling() {
    return (
      this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null
    );
  }
  get scrollHeight() {
    return this.children.length * 34;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      node.remove();
      node.parent = this;
      this.children.unshift(node);
    }
  }
  insertBefore(node, before) {
    node.remove();
    node.parent = this;
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.ownText = "";
    this.append(...nodes);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    this.parent = null;
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    return this.attributes.get(key);
  }
  addEventListener(type, fn) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(fn);
  }
  emit(type, properties = {}) {
    for (const fn of this.events.get(type) ?? [])
      fn({ target: this, button: 0, preventDefault() {}, ...properties });
  }
  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }
  matches(selector) {
    return selector === ":focus-visible" && !!this.focusVisible;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => {
      const matches = selector.startsWith(".")
        ? child.className.split(" ").includes(selector.slice(1))
        : child.tag === selector;
      return [...(matches ? [child] : []), ...child.querySelectorAll(selector)];
    });
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  getBoundingClientRect() {
    return { height: 400, top: 0 };
  }
  reportValidity() {
    return true;
  }
  focus() {}
}
async function fixture(run) {
  const previous = new Map(
    ["document", "ResizeObserver", "setInterval", "clearInterval"].map(
      (name) => [name, globalThis[name]],
    ),
  );
  const elements = new Map(),
    timers = new Map();
  let serial = 0;
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  globalThis.document = {
    getElementById: get,
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => {
      const node = new Element("text");
      node.textContent = text;
      return node;
    },
    body: new Element("body"),
  };
  globalThis.ResizeObserver = class {
    observe() {}
  };
  globalThis.setInterval = (fn) => {
    timers.set(++serial, fn);
    return serial;
  };
  globalThis.clearInterval = (id) => timers.delete(id);
  const scopeEvents = new Map();
  const scope = {
    addEventListener(type, fn) {
      if (!scopeEvents.has(type)) scopeEvents.set(type, []);
      scopeEvents.get(type).push(fn);
    },
    emit(type) {
      for (const fn of scopeEvents.get(type) ?? []) fn();
    },
    innerHeight: 900,
  };
  scope.removeEventListener = (type, fn) =>
    scopeEvents.set(
      type,
      (scopeEvents.get(type) ?? []).filter((item) => item !== fn),
    );
  const store = new NetworkCapture(),
    root = { ownerDocument: globalThis.document, getElementById: get };
  const capture = setupNetworkActivity(root, scope, store, {
      detailFrame: false,
    }),
    tick = () => {
      for (const fn of timers.values()) fn();
    };
  try {
    get("network-toggle").emit("click");
    await run({ store, get, tick, scope, capture });
  } finally {
    capture.destroy();
    for (const [key, value] of previous) globalThis[key] = value;
  }
}
function message(store, text) {
  const entry = store.add({
    kind: "message",
    connection: 1,
    direction: "in",
    url: "ws://localhost/messages",
    status: "Received",
  });
  store.preview(entry, "body", bodyPreview(JSON.stringify({ message: text })));
  return entry;
}

test("activity rows show their host and port, including labeled WebSocket frames", () =>
  fixture(({ store, get, tick }) => {
    for (const data of [
      { kind: "http", method: "GET", url: "https://api.example.com/items" },
      { kind: "http", method: "GET", url: "https://other.example.com/items" },
      {
        kind: "resource",
        method: "GET",
        url: "https://cdn.example.com/app.js",
      },
      { kind: "socket", url: "wss://socket.example.com:8443/messages" },
      {
        kind: "message",
        direction: "in",
        label: "Echoed message",
        url: "wss://socket.example.com:8443/messages",
      },
      { kind: "http", method: "GET", url: "https://[::1]:8443/items" },
      { kind: "http", method: "GET", url: "not a URL" },
      { kind: "http", method: "GET", url: "data:text/plain,hello" },
    ])
      store.add(data);
    store.recordEvent({ label: "Saved a draft" });
    tick();
    const rows = get("network-rows").children;
    assert.deepEqual(
      rows.map((row) => row.querySelector(".network-row-host").textContent),
      [
        "api.example.com",
        "other.example.com",
        "cdn.example.com",
        "socket.example.com:8443",
        "socket.example.com:8443",
        "[::1]:8443",
        "",
        "",
        "",
      ],
    );
    assert.equal(rows[0].firstChild.firstChild.textContent, "#1 GET /items");
    assert.equal(rows[1].firstChild.firstChild.textContent, "#2 GET /items");
    assert.equal(
      rows[4].firstChild.firstChild.textContent,
      "#5 Echoed message",
    );
    for (const row of rows.slice(6))
      assert.equal(row.querySelector(".network-row-host").hidden, true);
    assert.equal(rows[8].firstChild.firstChild.textContent, "#9 Saved a draft");
  }));

test("new messages never replace the selected inspector, with waterfall follow enabled or disabled", () =>
  fixture(({ store, get, tick }) => {
    const selected = message(store, "selected message");
    tick();
    get("network-rows").firstChild.emit("click");
    assert.match(get("network-detail").textContent, /selected message/);
    message(store, "new message with follow on");
    tick();
    assert.match(get("network-detail").textContent, /selected message/);
    assert.doesNotMatch(get("network-detail").textContent, /new message/);
    get("network-follow").checked = false;
    get("network-follow").emit("change");
    get("network-rows").scrollTop = 17;
    message(store, "new message with follow off");
    tick();
    assert.equal(
      get("network-rows").querySelectorAll(".network-row").length,
      1,
    );
    assert.equal(get("network-rows").scrollTop, 17);
    assert.match(get("network-detail").textContent, /selected message/);
    assert.ok(store.has(selected));
  }));
test("selecting a row pauses following until the same row is clicked again", () =>
  fixture(({ store, get, tick }) => {
    message(store, "inspect me");
    tick();
    const row = get("network-rows").firstChild;
    get("network-rows").scrollTop = 7;
    row.emit("click");
    get("network-detail").scrollTop = 19;
    const tree = get("network-detail").querySelector(".network-json-tree");
    for (let i = 0; i < 10; i++) message(store, `new ${i}`);
    tick();
    assert.equal(get("network-follow").checked, true);
    assert.equal(get("network-rows").scrollTop, 7);
    assert.equal(get("network-detail").scrollTop, 19);
    assert.equal(
      get("network-detail").querySelector(".network-json-tree"),
      tree,
    );
    assert.equal(row.getAttribute("aria-pressed"), "true");
    row.emit("click");
    assert.equal(row.getAttribute("aria-pressed"), "false");
    assert.equal(
      get("network-rows").scrollTop,
      get("network-rows").scrollHeight,
    );
    assert.match(get("network-detail").textContent, /Select a request/);
  }));
test("Deselect releases selection without releasing the view when follow is off", () =>
  fixture(({ store, get, tick }) => {
    message(store, "selected");
    tick();
    get("network-rows").firstChild.emit("click");
    for (let i = 0; i < 210; i++) message(store, `new ${i}`);
    tick();
    get("network-follow").checked = false;
    get("network-follow").emit("change");
    get("network-rows").scrollTop = 23;
    get("network-detail").querySelector(".network-deselect").emit("click");
    assert.equal(get("network-rows").scrollTop, 23);
    assert.match(get("network-detail").textContent, /Select a request/);
  }));
test("a pointer click survives live traffic shifting the rendered page between press and release", () =>
  fixture(async ({ store, get, tick, scope }) => {
    for (let i = 0; i < 200; i++) message(store, `message ${i}`);
    tick();
    const list = get("network-rows"),
      row = list.firstChild;
    list.emit("pointerdown");
    for (let i = 0; i < 20; i++) message(store, `later ${i}`);
    tick();
    assert.equal(
      list.firstChild,
      row,
      "the original click target must remain connected until click",
    );
    scope.emit("pointerup");
    tick();
    assert.equal(
      list.firstChild,
      row,
      "pointerup must not remove the target before click",
    );
    row.emit("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(get("network-detail").textContent, /"message 0"/);
    assert.doesNotMatch(get("network-detail").textContent, /later/);
    const next = list.children[7];
    next.emit("click");
    assert.equal(next.getAttribute("aria-pressed"), "true");
    assert.match(
      get("network-detail").textContent,
      /"message 7"/,
      "a new click must replace the previous selection without moving rows",
    );
  }));
test("switching selection after scrolling keeps only the new row selected and its inspector visible", () =>
  fixture(({ store, get, tick }) => {
    for (let i = 0; i < 30; i++) message(store, `message ${i}`);
    tick();
    const list = get("network-rows"),
      first = list.firstChild;
    first.emit("click");
    list.scrollTop = 500;
    const next = list.children[20];
    next.emit("click");
    assert.equal(first.getAttribute("aria-pressed"), "false");
    assert.equal(next.getAttribute("aria-pressed"), "true");
    assert.equal(list.scrollTop, 500);
    assert.match(get("network-detail").textContent, /"message 20"/);
    message(store, "incoming");
    tick();
    assert.match(get("network-detail").textContent, /"message 20"/);
    assert.equal(list.scrollTop, 500);
  }));
test("unchanged row labels are not replaced during live renders", () =>
  fixture(({ store, get, tick }) => {
    message(store, "first");
    tick();
    const row = get("network-rows").firstChild;
    const labels = [
        row.firstChild.firstChild,
        row.firstChild.lastChild,
        ...row.children.slice(1, 3),
      ],
      writes = labels.map((node) => node.textWrites);
    message(store, "second");
    tick();
    assert.deepEqual(
      labels.map((node) => node.textWrites),
      writes,
    );
  }));
test("following yields to pointer browsing and keyboard focus, then resumes when interaction ends", () =>
  fixture(({ store, get, tick }) => {
    message(store, "first");
    tick();
    const list = get("network-rows");
    list.emit("pointerenter");
    list.scrollTop = 7;
    message(store, "second");
    tick();
    assert.equal(list.scrollTop, 7);
    list.emit("pointerleave");
    tick();
    assert.equal(list.scrollTop, list.scrollHeight);
    const row = list.firstChild;
    row.focusVisible = true;
    list.emit("focusin", { target: row });
    list.scrollTop = 9;
    message(store, "third");
    tick();
    assert.equal(list.scrollTop, 9);
    list.emit("focusout", { relatedTarget: null });
    tick();
    assert.equal(list.scrollTop, list.scrollHeight);
  }));
test("pointer cancellation releases live rendering without changing selection", () =>
  fixture(async ({ store, get, tick, scope }) => {
    message(store, "first");
    tick();
    const list = get("network-rows");
    list.emit("pointerdown");
    message(store, "second");
    tick();
    assert.equal(list.children.length, 1);
    scope.emit("pointercancel");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(list.children.length, 2);
    assert.match(get("network-detail").textContent, /Select a request/);
  }));
test("toolbar applies retention limits together, trims history, and Clear keeps the limits", () =>
  fixture(({ store, get, tick }) => {
    assert.equal(get("network-limit-entries").value, "5000");
    assert.equal(get("network-limit-preview").value, "256");
    assert.equal(get("network-limit-messages").value, "2000");
    assert.equal(get("network-limit-bytes").value, "32");
    for (let i = 0; i < 6; i++) message(store, "x".repeat(4096));
    tick();
    get("network-limit-entries").value = "3";
    get("network-limit-messages").value = "2";
    get("network-limit-preview").value = "1";
    get("network-limit-bytes").value = "1";
    get("network-retention-form").emit("submit");
    assert.equal(store.entries.length, 2);
    assert.equal(store.bytes, 2048);
    assert.equal(store.limits.preview, 1024);
    assert.equal(store.limits.bytes, 1024 * 1024);
    assert.match(get("network-retention-status").textContent, /applied/);
    assert.equal(get("network-rows").children.length, 2);
    get("network-limit-entries").value = "-1";
    get("network-retention-form").emit("submit");
    assert.equal(store.limits.entries, 3);
    assert.equal(store.entries.length, 2);
    assert.match(get("network-retention-status").textContent, /whole numbers/);
    get("network-clear").emit("click");
    assert.equal(store.entries.length, 0);
    assert.equal(store.limits.entries, 3);
  }));
test("expired rows stay in place while browsing, with current retained history available on explicit navigation", () =>
  fixture(({ store, get, tick }) => {
    store.setLimits({ messages: 1000 });
    const selected = message(store, "old selected message");
    tick();
    get("network-rows").firstChild.emit("click");
    get("network-follow").checked = false;
    get("network-follow").emit("change");
    for (let i = 0; i < 1100; i++) message(store, `retained message ${i}`);
    tick();
    assert.equal(store.has(selected), false);
    assert.equal(store.entries.length, 1000);
    assert.equal(
      get("network-rows").querySelectorAll(".network-row").length,
      1,
    );
    assert.match(get("network-summary").textContent, /1000 matching/);
    assert.match(
      get("network-detail").textContent,
      /expired from retained history/,
    );
    assert.match(
      get("network-summary").textContent,
      /1 rows no longer retained/,
    );
    get("network-follow").checked = true;
    get("network-follow").emit("change");
    assert.equal(
      get("network-rows").querySelectorAll(".network-row").length,
      200,
    );
    assert.match(get("network-rows").textContent, /#1101/);
    get("network-rows").lastChild.emit("click");
    assert.match(get("network-detail").textContent, /retained message 1099/);
  }));
test("browsing freezes row order and the entire waterfall across selection changes while capture continues", () =>
  fixture(({ store, get, tick }) => {
    for (let i = 0; i < 250; i++) message(store, `message ${i}`);
    tick();
    const list = get("network-rows"),
      original = [...list.children],
      labels = original.map((row) => row.textContent);
    const scale = get("network-range").textContent,
      bars = original.map((row) => ({ ...row.lastChild.firstChild.style }));
    list.emit("pointerenter");
    list.scrollTop = 350;
    for (let i = 0; i < 500; i++) message(store, `background ${i}`);
    tick();
    assert.deepEqual(list.children, original);
    assert.deepEqual(
      list.children.map((row) => row.textContent),
      labels,
    );
    assert.equal(get("network-range").textContent, scale);
    assert.deepEqual(
      list.children.map((row) => ({ ...row.lastChild.firstChild.style })),
      bars,
    );
    assert.equal(store.entries.length, 750);
    assert.equal(store.paused, false);
    assert.match(get("network-latest").textContent, /500 new/);
    original[10].emit("click");
    original[100].emit("click");
    list.emit("pointerleave");
    for (let i = 0; i < 100; i++) message(store, `more ${i}`);
    tick();
    assert.deepEqual(list.children, original);
    assert.equal(list.scrollTop, 350);
    assert.equal(original[10].getAttribute("aria-pressed"), "false");
    assert.equal(original[100].getAttribute("aria-pressed"), "true");
    assert.match(get("network-detail").textContent, /"message 150"/);
    assert.equal(store.entries.length, 850);
    assert.equal(get("network-range").textContent, scale);
    assert.match(get("network-latest").textContent, /600 new/);
    original[100].emit("click");
    assert.notEqual(list.firstChild, original[0]);
    assert.match(list.lastChild.textContent, /#850 /);
    assert.equal(list.scrollTop, list.scrollHeight);
    assert.match(get("network-detail").textContent, /Select a request/);
  }));
test("new activity remains counted across filters, reconnects and retention, and its button resumes the latest view", () =>
  fixture(({ store, get, tick }) => {
    message(store, "initial");
    tick();
    get("network-rows").firstChild.emit("click");
    get("network-connection").value = "1";
    get("network-connection").emit("input");
    store.setLimits({ messages: 2, entries: 3 });
    for (let i = 0; i < 10; i++)
      store.add({
        kind: "message",
        connection: 2,
        direction: "in",
        url: "ws://localhost/reconnected",
        status: "Received",
      });
    tick();
    assert.match(get("network-latest").textContent, /10 new/);
    assert.equal(get("network-latest").hidden, false);
    get("network-sort-size").emit("click");
    get("network-search").value = "no match";
    get("network-search").emit("input");
    get("network-latest").emit("click");
    assert.equal(get("network-search").value, "");
    assert.equal(get("network-connection").value, "");
    assert.equal(get("network-filter").value, "");
    assert.equal(get("network-follow").checked, true);
    assert.equal(
      get("network-sort-size").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(get("network-latest").hidden, true);
    assert.match(get("network-rows").lastChild.textContent, /#11 /);
    assert.match(get("network-detail").textContent, /Select a request/);
    store.add({ kind: "message", connection: 2, direction: "in" });
    tick();
    assert.match(get("network-rows").lastChild.textContent, /#12 /);
  }));
test("holding a pointer cannot suppress incoming activity counts", () =>
  fixture(({ store, get, tick }) => {
    message(store, "initial");
    tick();
    const row = get("network-rows").firstChild;
    get("network-rows").emit("pointerdown");
    for (let i = 0; i < 10; i++) message(store, `during press ${i}`);
    tick();
    assert.equal(get("network-rows").firstChild, row);
    assert.equal(get("network-rows").children.length, 1);
    assert.match(get("network-latest").textContent, /10 new/);
    get("network-latest").emit("click");
    assert.equal(get("network-rows").children.length, 11);
    assert.equal(get("network-latest").hidden, true);
  }));
test("an empty fixed view still counts incoming activity excluded by filters", () =>
  fixture(({ store, get, tick }) => {
    get("network-search").value = "nothing matches";
    get("network-search").emit("input");
    get("network-rows").emit("pointerenter");
    for (let i = 0; i < 4; i++) message(store, `new ${i}`);
    tick();
    assert.match(get("network-latest").textContent, /4 new/);
    assert.equal(get("network-latest").hidden, false);
    get("network-latest").emit("click");
    assert.equal(
      get("network-rows").querySelectorAll(".network-row").length,
      4,
    );
  }));
test("paging a fixed view moves relative to its rows even after new messages arrive", () =>
  fixture(({ store, get, tick }) => {
    for (let i = 0; i < 250; i++) message(store, `message ${i}`);
    tick();
    get("network-follow").checked = false;
    get("network-follow").emit("change");
    for (let i = 0; i < 300; i++) message(store, `new ${i}`);
    tick();
    const list = get("network-rows");
    assert.match(list.firstChild.textContent, /#51 /);
    assert.match(list.lastChild.textContent, /#250 /);
    get("network-older").emit("click");
    assert.match(list.firstChild.textContent, /#1 /);
    assert.match(list.lastChild.textContent, /#50 /);
    get("network-newer").emit("click");
    assert.match(list.firstChild.textContent, /#51 /);
    assert.match(list.lastChild.textContent, /#250 /);
    get("network-newer").emit("click");
    assert.match(list.firstChild.textContent, /#251 /);
    assert.match(list.lastChild.textContent, /#450 /);
  }));
test("size-sorted browsing holds row order when incoming sizes would otherwise reorder it", () =>
  fixture(({ store, get, tick }) => {
    const first = store.add({
      kind: "http",
      url: "http://localhost/first",
      transferSize: 10,
      end: 1,
    });
    store.add({
      kind: "http",
      url: "http://localhost/second",
      transferSize: 20,
      end: 1,
    });
    tick();
    get("network-sort-size").emit("click");
    const list = get("network-rows"),
      original = [...list.children];
    store.update(first, { transferSize: 100 });
    store.add({
      kind: "http",
      url: "http://localhost/new",
      transferSize: 200,
      end: 1,
    });
    tick();
    assert.deepEqual(list.children, original);
    assert.match(list.firstChild.textContent, /second/);
    assert.equal(store.entries.length, 3);
    get("network-sort-size").emit("click");
    assert.match(list.firstChild.textContent, /second/);
    assert.match(list.lastChild.textContent, /new/);
  }));
test("size sorting uses the displayed sizes and keeps unknown sizes last in either direction", () => {
  const entries = [
    { id: 1, start: 0, body: { size: null } },
    { id: 2, start: 1, body: { size: 0 } },
    { id: 3, start: 2, responseBody: { size: 1024 } },
    { id: 4, start: 3, transferSize: 16 },
    { id: 5, start: 4, body: { size: 1024, expired: true } },
  ];
  assert.deepEqual(
    sortActivity(entries, "largest").map((e) => e.id),
    [3, 5, 4, 2, 1],
  );
  assert.deepEqual(
    sortActivity(entries, "smallest").map((e) => e.id),
    [2, 4, 3, 5, 1],
  );
  assert.deepEqual(
    sortActivity(entries).map((e) => e.id),
    [1, 2, 3, 4, 5],
  );
  assert.equal(activitySize(entries[1]), 0);
  assert.equal(activitySize({ body: { size: NaN } }), null);
  assert.deepEqual(
    entries.map((e) => e.id),
    [1, 2, 3, 4, 5],
  );
});
test("Size cycles in the UI without changing the waterfall time scale", () =>
  fixture(({ store, get, tick }) => {
    store.add({
      kind: "http",
      method: "GET",
      url: "http://localhost/small",
      start: 0,
      end: 100,
      transferSize: 1,
      status: 200,
    });
    store.add({
      kind: "http",
      method: "GET",
      url: "http://localhost/large",
      start: 50,
      end: 200,
      transferSize: 1024,
      status: 200,
    });
    tick();
    get("network-sort-size").emit("click");
    assert.match(get("network-rows").firstChild.textContent, /large/);
    assert.equal(get("network-follow").checked, false);
    assert.equal(
      get("network-rows").firstChild.lastChild.firstChild.style.left,
      "25%",
    );
    assert.match(get("network-range").textContent, /0\.0 ms → 200\.0 ms/);
    get("network-sort-size").emit("click");
    assert.match(get("network-rows").firstChild.textContent, /small/);
    get("network-sort-size").emit("click");
    assert.match(get("network-rows").firstChild.textContent, /small/);
    get("network-sort-size").emit("click");
    get("network-follow").checked = true;
    get("network-follow").emit("change");
    assert.match(get("network-rows").firstChild.textContent, /small/);
    assert.equal(
      get("network-sort-size").getAttribute("aria-pressed"),
      "false",
    );
  }));
test("size pages start with the globally largest entries, including entries older than the latest 200", () =>
  fixture(({ store, get, tick }) => {
    for (let i = 0; i < 250; i++)
      store.add({
        kind: "http",
        method: "GET",
        url: `http://localhost/${i}`,
        start: i,
        end: 300,
        transferSize: 1000 - i,
        status: 200,
      });
    tick();
    get("network-sort-size").emit("click");
    assert.match(get("network-rows").firstChild.textContent, /#1 /);
    assert.equal(get("network-rows").children.length, 200);
    assert.equal(get("network-older").textContent, "Next");
    get("network-older").emit("click");
    assert.match(get("network-rows").firstChild.textContent, /#201 /);
    assert.equal(get("network-rows").children.length, 50);
    assert.equal(get("network-older").disabled, true);
    get("network-newer").emit("click");
    assert.match(get("network-rows").firstChild.textContent, /#1 /);
  }));
test("an empty filter result exposes retained history through Reset filters", () =>
  fixture(({ store, get, tick }) => {
    message(store, "retained");
    tick();
    get("network-connection").value = "expired-connection";
    get("network-connection").emit("input");
    assert.match(
      get("network-rows").textContent,
      /No retained activity matches/,
    );
    const reset = get("network-rows").querySelector("button");
    assert.equal(reset.textContent, "Reset filters");
    reset.emit("click");
    assert.equal(
      get("network-rows").querySelectorAll(".network-row").length,
      1,
    );
    assert.equal(store.entries.length, 1);
  }));
