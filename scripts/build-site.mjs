import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { parseHTML } from "linkedom";

const root = fileURLToPath(new URL("../", import.meta.url));
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export async function buildSite({
  output = resolve(root, "dist"),
  basePath = "/web-network-inspector/",
} = {}) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath))
    throw new Error("basePath must be an absolute directory path.");
  output = resolve(output);
  if (output === resolve(root) || root.startsWith(output + "/"))
    throw new Error("Refusing to replace the source directory.");
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const header = (active) =>
    `<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="header-inner wrap"><a class="brand" href="${basePath}"><img src="${basePath}assets/wni-mark.svg" width="32" height="32" alt=""><span>Web Network Inspector</span></a><nav class="header-nav" aria-label="Main navigation"><a href="${basePath}"${active === "overview" ? ' aria-current="page"' : ""}>Overview</a><a href="${basePath}demo/">Live demo</a><a href="${basePath}docs/"${active === "docs" ? ' aria-current="page"' : ""}>Documentation</a><a class="source-link" href="https://github.com/inferal-oss/web-network-inspector">GitHub ↗</a></nav></div></header>`;
  const sponsor = `<p class="footer-sponsor">Sponsored by <a href="https://inferal.com/"><img src="${basePath}assets/inferal-mark.svg" width="12" height="14" alt="">Inferal</a></p>`;
  const footer = `<footer class="site-footer"><div class="wrap footer-main"><div><a class="brand" href="${basePath}"><img src="${basePath}assets/wni-mark.svg" width="28" height="28" alt="">Web Network Inspector</a><p>Your network, messages, and application events.<br>One inspector. Yours to extend.</p></div><nav class="footer-links" aria-label="Footer"><a href="${basePath}demo/">Live demo</a><a href="${basePath}docs/api/">API reference</a><a href="${basePath}docs/styling/">Styling guide</a><a href="https://github.com/inferal-oss/web-network-inspector">Source ↗</a></nav></div><div class="wrap footer-bottom">${sponsor}<a href="https://github.com/inferal-oss/web-network-inspector/blob/main/LICENSE">MIT licensed · Made to be useful</a><a href="/">Inferal Open Source ↗</a></div></footer>`;
  await rm(output, { recursive: true, force: true });
  await mkdir(resolve(output, "assets"), { recursive: true });
  await cp(resolve(root, "site/assets"), resolve(output, "assets"), {
    recursive: true,
  });
  await cp(resolve(root, "site/site.css"), resolve(output, "assets/site.css"));
  await cp(resolve(root, "site/site.js"), resolve(output, "assets/site.js"));
  await cp(
    resolve(root, "examples/screenshots/demo.png"),
    resolve(output, "assets/demo.png"),
  );
  await cp(resolve(root, "src"), resolve(output, "src"), { recursive: true });
  await cp(resolve(root, "examples"), resolve(output, "demo"), {
    recursive: true,
    filter: (source) => !source.includes("/screenshots"),
  });
  let demo = await readFile(resolve(output, "demo/index.html"), "utf8");
  demo = demo
    .replace(
      "</head>",
      `<link rel="stylesheet" href="${basePath}assets/site.css"><link rel="icon" href="${basePath}assets/wni-mark.svg" type="image/svg+xml"></head>`,
    )
    .replace(
      "<main>",
      `<nav class="demo-site-nav" aria-label="Demo navigation"><a href="${basePath}">← Web Network Inspector</a><a href="${basePath}docs/api/">API reference</a><a href="${basePath}docs/styling/">Styling guide</a></nav><main>`,
    )
    .replace(
      "</main>",
      `<footer class="demo-site-footer"><div class="footer-bottom">${sponsor}<a href="${basePath}">Back to the project →</a></div></footer></main>`,
    );
  await writeFile(resolve(output, "demo/index.html"), demo);
  const landing = (await readFile(resolve(root, "site/index.html"), "utf8"))
    .replaceAll("{{BASE}}", basePath)
    .replaceAll("{{VERSION}}", escape(pkg.version))
    .replace("{{HEADER}}", header("overview"))
    .replace("{{FOOTER}}", footer);
  await writeFile(resolve(output, "index.html"), landing);
  await writeFile(resolve(output, ".nojekyll"), "");
  const pages = [
    ["Getting started", "docs/", "docs/getting-started.md"],
    ["API reference", "docs/api/", "docs/api.md"],
    ["Styling guide", "docs/styling/", "docs/styling.md"],
  ];
  for (const [title, path, source] of pages) {
    const html = await marked.parse(
      await readFile(resolve(root, source), "utf8"),
    );
    const { document } = parseHTML(
      `<html><body><article>${html}</article></body></html>`,
    );
    const used = new Map(),
      toc = [];
    for (const heading of document.querySelectorAll("h2,h3")) {
      const slug = heading.textContent
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const count = used.get(slug) ?? 0;
      used.set(slug, count + 1);
      heading.id = slug + (count ? `-${count}` : "");
      if (heading.tagName === "H2")
        toc.push(`<a href="#${heading.id}">${escape(heading.textContent)}</a>`);
    }
    const links = pages
      .map(
        ([name, href]) =>
          `<a href="${basePath}${href}"${href === path ? ' aria-current="page"' : ""}>${name}</a>`,
      )
      .join("");
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Web Network Inspector</title><meta name="description" content="${escape(title)} for Web Network Inspector: a small, extensible in-page network waterfall."><link rel="icon" href="${basePath}assets/wni-mark.svg" type="image/svg+xml"><link rel="stylesheet" href="${basePath}assets/site.css"><script type="module" src="${basePath}assets/site.js"></script></head><body>${header("docs")}<main id="main" class="wrap docs-shell"><aside class="docs-sidebar"><span class="tiny-caps">DOCUMENTATION</span><nav aria-label="Documentation">${links}<a href="${basePath}demo/">Live demo ↗</a></nav></aside><article class="doc-content"><div class="doc-breadcrumb">WEB NETWORK INSPECTOR / DOCS</div>${document.querySelector("article").innerHTML}</article><aside class="doc-toc"><span class="tiny-caps">ON THIS PAGE</span><nav aria-label="On this page">${toc.join("")}</nav></aside></main>${footer}</body></html>`;
    await mkdir(resolve(output, path), { recursive: true });
    await writeFile(resolve(output, path, "index.html"), page);
  }
  console.log(
    "Built project site, live demo, API reference, and styling guide.",
  );
  return { output, basePath };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
