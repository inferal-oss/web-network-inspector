import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { highlightHTML } from "../scripts/highlight.mjs";
test("build-time highlighting preserves source text and escapes HTML examples", () => {
  const source = '<img src=x onerror="alert(1)">';
  const html = highlightHTML(
    '<pre><code class="language-html">&lt;img src=x onerror="alert(1)"&gt;</code></pre>',
  );
  const { document } = parseHTML(html);
  const code = document.querySelector("code");
  assert.equal(code.textContent, source);
  assert.equal(code.querySelector("img"), null);
  assert.ok(code.querySelector(".hljs-tag"));
});
test("unknown snippet languages remain readable without guessing their syntax", () => {
  const { document } = parseHTML(
    highlightHTML('<pre><code class="language-made-up">a &lt; b</code></pre>'),
  );
  assert.equal(document.querySelector("code").textContent, "a < b");
  assert.equal(
    document.querySelector("code").classList.contains("hljs"),
    false,
  );
});
