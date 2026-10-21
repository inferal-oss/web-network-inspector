import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { parseHTML } from "linkedom";
import { highlightHTML } from "./highlight.mjs";
import { captureScreenshots } from "./screenshot.mjs";

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
  const hash = createHash("sha256");
  async function hashDirectory(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      hash.update(entry.name);
      if (entry.isDirectory()) await hashDirectory(path);
      else hash.update(await readFile(path));
    }
  }
  await hashDirectory(resolve(root, "src"));
  for (const file of [
    "examples/demo.js",
    "examples/insight-column.js",
    "examples/detail-renderer.js",
    "scripts/screenshot.mjs",
    "examples/style.css",
    "site/site.css",
    "site/site.js",
  ])
    hash.update(await readFile(resolve(root, file)));
  hash.update(await readFile(resolve(root, "examples/display/display.js")));
  hash.update(await readFile(resolve(root, "examples/display/display.css")));
  const revision = hash.digest("hex").slice(0, 12);
  const runtime = "runtime-" + revision;
  const versionAssets = (html) =>
    html
      .replaceAll(
        `${basePath}assets/demo.png"`,
        `${basePath}assets/demo.png?v=${revision}"`,
      )
      .replaceAll(
        `${basePath}assets/site.css"`,
        `${basePath}assets/site.css?v=${revision}"`,
      )
      .replaceAll(
        `${basePath}assets/site.js"`,
        `${basePath}assets/site.js?v=${revision}"`,
      );
  const displayHead = `<link rel="stylesheet" href="${basePath}assets/display/widget.css"><link rel="stylesheet" href="${basePath}assets/display/display.css?v=${revision}"><script src="${basePath}assets/display/openregard-0.3.0.js"></script><script src="${basePath}assets/display/display.js?v=${revision}"></script>`;
  const header = (active) =>
    `<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="header-inner wrap"><a class="brand" href="${basePath}"><img src="${basePath}assets/wni-mark.svg" width="32" height="32" alt=""><span>Web Network Inspector</span></a><nav class="header-nav" aria-label="Main navigation"><a href="${basePath}"${active === "overview" ? ' aria-current="page"' : ""}>Overview</a><a href="${basePath}demo/">Live demo</a><a href="${basePath}docs/"${active === "docs" ? ' aria-current="page"' : ""}>Documentation</a><a class="source-link" href="https://github.com/inferal-oss/web-network-inspector">GitHub ↗</a><div data-inferal-display></div></nav></div></header>`;
  const sponsor = `<p class="footer-sponsor">Sponsored by <a href="https://inferal.com/"><img src="${basePath}assets/inferal-mark.svg" width="12" height="14" alt="">Inferal</a></p>`;
  const footer = `<footer class="site-footer"><div class="wrap footer-main"><div class="footer-identity"><a class="brand" href="${basePath}"><img src="${basePath}assets/wni-mark.svg" width="38" height="38" alt="">Web Network Inspector</a><p>A little more clarity.<br>A lot less guessing.</p><span class="footer-caption">NETWORK · MESSAGES · APPLICATION EVENTS</span><a class="footer-demo-link" href="${basePath}demo/">Open the live demo <span aria-hidden="true">↗</span></a></div><nav class="footer-links" aria-label="Footer"><div><h2>GET STARTED</h2><a href="${basePath}docs/">Installation</a><a href="${basePath}docs/react/">React component</a><a href="${basePath}docs/api/">API reference</a></div><div><h2>MAKE IT YOURS</h2><a href="${basePath}docs/columns/">Waterfall columns</a><a href="${basePath}docs/details/">Content previews</a><a href="${basePath}docs/styling/">Styling guide</a></div><div><h2>IN THE OPEN</h2><a href="https://github.com/inferal-oss/web-network-inspector">Source on GitHub ↗</a><a href="https://github.com/inferal-oss/web-network-inspector/issues">Report an issue ↗</a><a href="/">More Inferal projects ↗</a></div></nav></div><div class="wrap footer-bottom">${sponsor}<span>Built for curious developers. Apache-2.0 or MIT. Your choice.</span><a href="https://github.com/inferal-oss/web-network-inspector/blob/main/LICENSE">View license ↗</a></div></footer>`;

  await rm(output, { recursive: true, force: true });
  await mkdir(resolve(output, "assets"), { recursive: true });
  await cp(resolve(root, "site/assets"), resolve(output, "assets"), {
    recursive: true,
  });
  await cp(
    resolve(root, "examples/display"),
    resolve(output, "assets/display"),
    { recursive: true },
  );
  await cp(resolve(root, "site/site.css"), resolve(output, "assets/site.css"));
  await cp(resolve(root, "site/site.js"), resolve(output, "assets/site.js"));
  await captureScreenshots({ output: resolve(output, "assets") });
  await cp(resolve(root, "src"), resolve(output, "src"), { recursive: true });
  await cp(resolve(root, "examples"), resolve(output, "demo"), {
    recursive: true,
    filter: (source) => !source.includes("/screenshots"),
  });
  await cp(resolve(root, "src"), resolve(output, runtime), { recursive: true });
  const demoSource = (await readFile(resolve(output, "demo/demo.js"), "utf8"))
    .replaceAll("../src/", "../" + runtime + "/")
    .replaceAll('"./insight-column.js"', `"./insight-column.js?v=${revision}"`)
    .replaceAll(
      '"./detail-renderer.js"',
      `"./detail-renderer.js?v=${revision}"`,
    );
  await writeFile(resolve(output, "demo/demo.js"), demoSource);
  let demo = await readFile(resolve(output, "demo/index.html"), "utf8");
  demo = demo
    .replace(
      'src="./display/display.js"',
      `src="./display/display.js?v=${revision}"`,
    )
    .replace(
      'href="./display/display.css"',
      `href="./display/display.css?v=${revision}"`,
    )
    .replace('src="./demo.js"', `src="./demo.js?v=${revision}"`)
    .replace('href="./style.css"', `href="./style.css?v=${revision}"`)
    .replace(
      "</head>",
      `<link rel="stylesheet" href="${basePath}assets/site.css"><link rel="icon" href="${basePath}assets/wni-mark.svg" type="image/svg+xml"></head>`,
    )
    .replace(
      "<main>",
      `<nav class="demo-site-nav" aria-label="Demo navigation"><a href="${basePath}">← Web Network Inspector</a><a href="${basePath}docs/api/">API reference</a><a href="${basePath}docs/styling/">Styling guide</a></nav><main>`,
    )
    .replace("</main>", `</main>${footer}`);
  await writeFile(
    resolve(output, "demo/index.html"),
    versionAssets(highlightHTML(demo)),
  );
  const landing = (await readFile(resolve(root, "site/index.html"), "utf8"))
    .replaceAll("{{BASE}}", basePath)
    .replaceAll("{{VERSION}}", escape(pkg.version))
    .replace("{{HEADER}}", header("overview"))
    .replace("{{FOOTER}}", footer)
    .replace("</head>", displayHead + "</head>");
  await writeFile(
    resolve(output, "index.html"),
    versionAssets(highlightHTML(landing)),
  );
  await writeFile(resolve(output, ".nojekyll"), "");
  const pages = [
    ["Getting started", "docs/", "docs/getting-started.md"],
    ["API reference", "docs/api/", "docs/api.md"],
    ["Styling guide", "docs/styling/", "docs/styling.md"],
    ["React component", "docs/react/", "docs/react.md"],
    ["Capture filters", "docs/filtering/", "docs/filtering.md"],
    ["Request details", "docs/details/", "docs/details.md"],
    ["Waterfall columns", "docs/columns/", "docs/columns.md"],
    ["Local history", "docs/storage/", "docs/storage.md"],
    ["View preferences", "docs/preferences/", "docs/preferences.md"],
    ["Display preferences", "docs/display/", "docs/display.md"],
  ];
  for (const [title, path, source] of pages) {
    const html = await marked.parse(
      await readFile(resolve(root, source), "utf8"),
    );
    const { document } = parseHTML(
      `<html><body><article>${html}</article></body></html>`,
    );
    // Keep Markdown links useful in the source repository and the hosted guides.
    for (const link of document.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      const target = pages.find(
        ([, , file]) => file === "docs/" + href?.split("#")[0],
      );
      if (target)
        link.setAttribute(
          "href",
          basePath +
            target[1] +
            (href.includes("#")
              ? "#" + href.split("#").slice(1).join("#")
              : ""),
        );
    }
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
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Web Network Inspector</title><meta name="description" content="${escape(title)} for Web Network Inspector: a small, extensible in-page network waterfall."><link rel="icon" href="${basePath}assets/wni-mark.svg" type="image/svg+xml">${displayHead}<link rel="stylesheet" href="${basePath}assets/site.css"><script type="module" src="${basePath}assets/site.js"></script></head><body>${header("docs")}<main id="main" class="wrap docs-shell"><aside class="docs-sidebar"><span class="tiny-caps">DOCUMENTATION</span><nav aria-label="Documentation">${links}<a href="${basePath}demo/">Live demo ↗</a></nav></aside><article class="doc-content"><div class="doc-breadcrumb">WEB NETWORK INSPECTOR / DOCS</div>${highlightHTML(document.querySelector("article").innerHTML)}</article><aside class="doc-toc"><span class="tiny-caps">ON THIS PAGE</span><nav aria-label="On this page">${toc.join("")}</nav></aside></main>${footer}</body></html>`;
    await mkdir(resolve(output, path), { recursive: true });
    await writeFile(resolve(output, path, "index.html"), versionAssets(page));
  }
  console.log(
    "Built project site, live demo, API reference, and styling guide.",
  );
  return { output, basePath };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
