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
