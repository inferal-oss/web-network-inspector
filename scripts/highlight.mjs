import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import { parseHTML } from "linkedom";
for (const [name, language] of Object.entries({
  javascript,
  typescript,
  css,
  xml,
  bash,
  json,
}))
  hljs.registerLanguage(name, language);

/** Highlight at build time so the published site needs no client highlighter. */
export function highlightHTML(html) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const code of document.querySelectorAll("pre > code")) {
    const name = /(?:^|\s)language-([\w-]+)/.exec(code.className)?.[1];
    if (!name || !hljs.getLanguage(name)) continue;
    code.innerHTML = hljs.highlight(code.textContent, {
      language: name,
      ignoreIllegals: true,
    }).value;
    code.classList.add("hljs");
  }
  return document.body.innerHTML;
}
