import test from "node:test";
import assert from "node:assert/strict";
import { bodyPreview } from "../src/network-capture.js";
import { jsonBodyPreview } from "../src/network-json.js";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.events = new Map();
    this.open = false;
    this.ownText = "";
  }
  set textContent(value) {
    this.ownText = String(value);
    this.children = [];
  }
  get textContent() {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }
  append(...nodes) {
    for (const child of nodes) {
      child.parent = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    this.parent = null;
  }
  addEventListener(name, callback) {
    this.events.set(name, callback);
  }
  emit(name) {
    this.events.get(name)?.();
  }
}
const document = { createElement: (tag) => new Element(tag) };
const render = (text) => jsonBodyPreview(bodyPreview(text), document);
const nodes = (root) => {
  const result = [],
    pending = [root];
  while (pending.length) {
    const current = pending.pop();
    result.push(current);
    pending.push(...current.children);
  }
  return result;
};

test("JSON objects show their fields and load nested arrays only when expanded", () => {
  const tree = render(
    '{"type":"message","snapshot":{"events":[1,2],"ready":true},"empty":null}',
  );
  const root = tree.children[0];
  assert.equal(root.open, true);
  assert.match(root.textContent, /"type": "message"/);
  assert.match(root.textContent, /"empty": null/);
  const nested = nodes(tree).find(
    (node) =>
      node.tag === "details" && node.textContent.startsWith('"snapshot"'),
  );
  assert.equal(nested.open, false);
  assert.doesNotMatch(nested.textContent, /events/);
  nested.open = true;
  nested.emit("toggle");
  assert.match(nested.textContent, /"events": \[ 2 items \]/);
  assert.match(nested.textContent, /"ready": true/);
  const array = nodes(nested).find(
    (node) => node.tag === "details" && node.textContent.startsWith('"events"'),
  );
  array.open = true;
  array.emit("toggle");
  assert.match(array.textContent, /0: 1/);
  assert.match(array.textContent, /1: 2/);
  const count = nodes(tree).length;
  nested.open = false;
  nested.emit("toggle");
  nested.open = true;
  nested.emit("toggle");
  assert.equal(nodes(tree).length, count);
});
test("strings and property names remain inert text, including HTML and prototype keys", () => {
  const tree = render(
    '{"<img onerror=boom>":"<script>boom</script>","__proto__":{"safe":true}}',
  );
  assert.match(tree.textContent, /<script>boom<\/script>/);
  assert.match(tree.textContent, /"__proto__"/);
  assert.equal(
    nodes(tree).some((node) => node.tag === "script" || node.tag === "img"),
    false,
  );
});
test("large integers, number spelling, and negative zero retain their wire representation", () => {
  const tree = render(
    '{"id":9007199254740993,"decimal":1.2300,"zero":-0,"huge":1e999}',
  );
  assert.match(tree.textContent, /9007199254740993/);
  assert.match(tree.textContent, /1\.2300/);
  assert.match(tree.textContent, /-0/);
  assert.match(tree.textContent, /1e999/);
});
test("expired, binary and non-JSON previews retain the text or hex fallback", () => {
  assert.equal(
    jsonBodyPreview({ ...bodyPreview("{}"), expired: true }, document),
    null,
  );
  assert.equal(
    jsonBodyPreview(bodyPreview(new Uint8Array([123, 125])), document),
    null,
  );
  assert.equal(render("not JSON"), null);
  assert.equal(jsonBodyPreview(null, document), null);
  assert.equal(render("null").textContent, "null");
  assert.equal(render("false").textContent, "false");
});
function expandAll(tree) {
  const pending = [tree];
  while (pending.length) {
    const current = pending.pop();
    if (current.tag === "details") {
      current.open = true;
      current.emit("toggle");
    }
    pending.push(...current.children);
  }
  return tree;
}
test("truncated collection responses retain complete rows and mark the last partial number", () => {
  const text = '{"items":[["item-000",100000,200],["item-001",101000,2';
  const tree = expandAll(
    jsonBodyPreview({ ...bodyPreview(text), truncated: true }, document),
  );
  assert.match(
    tree.textContent,
    /"items": \[ 2 captured items · incomplete \]/,
  );
  assert.match(tree.textContent, /"item-000"/);
  assert.match(tree.textContent, /1: 100000/);
  assert.match(tree.textContent, /2: 200/);
  assert.match(tree.textContent, /2: 2 … \[number cut off\]/);
  assert.match(tree.textContent, /Preview ends here/);
});
test("truncated strings, Unicode escapes, object keys and literals never invent data", () => {
  for (const [source, expected] of [
    ['{"message":"half', /"half … \[string cut off\]/],
    ['{"message":"a\\u12', /a\\u12 … \[string cut off\]/],
    ['{"par', /"par … key cut off/],
    ['{"pending":', /"pending": … not captured/],
    ['{"ready":tru', /tru … \[literal cut off\]/],
    ['{"count":1e+', /1e\+ … \[number cut off\]/],
    ['{"__proto__":{"value":9007199254740993},"end":', /9007199254740993/],
  ]) {
    const tree = jsonBodyPreview(
      { ...bodyPreview(source), truncated: true },
      document,
    );
    assert.ok(tree, source);
    expandAll(tree);
    assert.match(tree.textContent, expected, source);
  }
  for (const source of [
    '{"a":01',
    '{"a":1.e',
    '{"a":"\\q',
    '{"a":"\\uQ',
    '{"a":true nope',
    "[1,]",
    '{"a":1,}',
    "{oops",
  ]) {
    assert.equal(
      jsonBodyPreview({ ...bodyPreview(source), truncated: true }, document),
      null,
      source,
    );
  }
});
test("every captured prefix of nested JSON renders safely within the same byte limit", () => {
  const text =
    '{"rows":[["escaped\\\"name",-12.5e+3,null,true,false],{"emoji":"😀","slash":"\\\\","unicode":"\\u1234"}],"tail":7}';
  const size = new TextEncoder().encode(text).length;
  for (let limit = 1; limit < size; limit++) {
    const preview = bodyPreview(text, limit),
      tree = jsonBodyPreview(preview, document);
    assert.ok(tree, `valid JSON prefix at byte ${limit}`);
    assert.ok(nodes(tree).length < 100);
    assert.ok(preview.bytes.length <= limit);
  }
});
test("empty partial branches do not accumulate end markers when reopened", () => {
  const tree = jsonBodyPreview(
      { ...bodyPreview("{"), truncated: true },
      document,
    ),
    root = tree.children[0];
  for (let i = 0; i < 10; i++) {
    root.open = false;
    root.emit("toggle");
    root.open = true;
    root.emit("toggle");
  }
  assert.equal(
    nodes(tree).filter((node) => node.className === "network-json-end").length,
    1,
  );
});
test("large arrays page their direct children and deep input remains bounded or falls back safely", () => {
  const tree = render(JSON.stringify(Array.from({ length: 250 }, (_, i) => i)));
  assert.equal(
    nodes(tree).filter((node) => node.className === "network-json-leaf").length,
    100,
  );
  let more = nodes(tree).find((node) => node.tag === "button");
  assert.match(more.textContent, /150 remaining/);
  more.emit("click");
  assert.equal(
    nodes(tree).filter((node) => node.className === "network-json-leaf").length,
    200,
  );
  more = nodes(tree).find((node) => node.tag === "button");
  more.emit("click");
  assert.equal(
    nodes(tree).filter((node) => node.className === "network-json-leaf").length,
    250,
  );
  assert.equal(
    nodes(tree).some((node) => node.tag === "button"),
    false,
  );
  const deep = render("[".repeat(3000) + "0" + "]".repeat(3000));
  assert.ok(deep === null || nodes(deep).length < 10);
});
