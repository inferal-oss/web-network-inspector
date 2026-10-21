import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeColumns,
  defaultColumns,
  httpCode,
  columnRenderers,
} from "../src/columns.js";
import { previewLanguage } from "../src/syntax-highlight.js";
import hljs from "../src/vendor/highlight.js";

test("column definitions reject invalid layouts and copy the defaults", () => {
  const columns = normalizeColumns();
  assert.deepEqual(
    columns.map((c) => c.id),
    ["hostPath", "status", "code", "size", "waterfall"],
  );
  columns[0].width = 999;
  assert.equal(defaultColumns[0].width, 320);
  for (const definitions of [
    [],
    null,
    [{ id: "x", label: "X", render: null }],
    [defaultColumns[0], defaultColumns[0]],
    [{ ...defaultColumns[0], width: NaN }],
    [{ ...defaultColumns[0], minWidth: 1 }],
  ])
    assert.throws(() => normalizeColumns(definitions));
  assert.equal(columnRenderers.code, defaultColumns[2].render);
});
test("HTTP codes exclude WebSocket close codes and preserve resource status", () => {
  assert.equal(httpCode({ status: 201 }), 201);
  assert.equal(httpCode({ status: "Loaded", httpCode: 304 }), 304);
  assert.equal(httpCode({ status: "Closed", closeCode: 1000 }), null);
  assert.equal(httpCode({ status: 1000 }), null);
});
test("the full highlighter registry resolves MIME types, suffixes, and language aliases", () => {
  assert.ok(hljs.listLanguages().length > 180);
  for (const [mime, url, expected] of [
    ["application/problem+json", "", "json"],
    ["text/css; charset=utf-8", "", "css"],
    ["text/x-python", "", "python"],
    ["application/octet-stream", "https://example.com/sample.rs", "rust"],
    ["application/xml", "", "xml"],
    ["text/plain", "https://example.com/sample.yaml", "yaml"],
  ])
    assert.equal(previewLanguage(hljs, mime, url), expected);
});

test("sort configuration accepts comparators and explicit opt-out; legacy Size resolves to its comparator", async () => {
  const { sizeSorter } = await import("../src/columns.js");
  assert.equal(
    normalizeColumns([{ ...defaultColumns[3], sort: false }])[0].sort,
    false,
  );
  assert.equal(
    normalizeColumns([{ ...defaultColumns[3], sort: "size" }])[0].sort,
    sizeSorter,
  );
  assert.throws(() => normalizeColumns([{ ...defaultColumns[3], sort: true }]));
});
test("custom comparators sort copies in both directions with stable chronological ties", async () => {
  const { sortActivity } = await import("../src/network-activity.js");
  const entries = [
    { id: 1, start: 10, value: 2 },
    { id: 2, start: 20, value: 1 },
    { id: 3, start: 30, value: 2 },
  ];
  const compare = (a, b) => a.value - b.value;
  assert.deepEqual(
    sortActivity(entries, { compare, direction: "descending" }).map(
      (e) => e.id,
    ),
    [1, 3, 2],
  );
  assert.deepEqual(
    sortActivity(entries, { compare, direction: "ascending" }).map((e) => e.id),
    [2, 1, 3],
  );
  assert.deepEqual(
    entries.map((e) => e.id),
    [1, 2, 3],
  );
  assert.throws(
    () => sortActivity(entries, { compare: () => NaN, direction: "ascending" }),
    /finite number/,
  );
});
