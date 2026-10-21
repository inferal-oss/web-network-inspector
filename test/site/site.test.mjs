import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { parseHTML } from "linkedom";
import { buildSite } from "../../scripts/build-site.mjs";
let server, browser, origin, output;
const base = "/web-network-inspector/";
before(async () => {
  ({ output } = await buildSite());
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith(base)) {
        res.writeHead(404).end();
        return;
      }
      let path = resolve(output, "." + url.pathname.slice(base.length - 1));
      if (!path.startsWith(output + "/") && path !== output) {
        res.writeHead(404).end();
        return;
      }
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.writeHead(200, {
        "content-type": types[extname(path)] ?? "application/octet-stream",
      });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  try {
    await browser?.close();
  } finally {
    if (server) await new Promise((done) => server.close(done));
  }
});
async function pageAt(path, run) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(origin + base + path);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
test("all site pages and local assets resolve beneath the project prefix", async () => {
  for (const path of [
    "",
    "docs/",
    "docs/api/",
    "docs/styling/",
    "docs/react/",
    "docs/filtering/",
    "docs/details/",
    "docs/storage/",
    "docs/display/",
    "demo/",
  ]) {
    const file = resolve(output, path, "index.html");
    const { document } = parseHTML(await readFile(file, "utf8"));
    for (const node of document.querySelectorAll(
      "a[href],link[href],script[src],img[src]",
    )) {
      const url = new URL(
        node.getAttribute("href") ?? node.getAttribute("src"),
        origin + base + path,
      );
      if (url.origin !== origin || url.pathname === "/") continue;
      assert.ok(
        url.pathname.startsWith(base),
        `${path}: ${url.pathname} escapes the project prefix`,
      );
      const response = await fetch(url);
      assert.equal(response.status, 200, `${path}: ${url.pathname}`);
    }
    assert.match(
      document.querySelector("footer").textContent,
      /Sponsored by Inferal/,
    );
  }
});
test("landing navigation, example tabs, and keyboard controls work", () =>
  pageAt("", async (page) => {
    await page
      .getByRole("heading", { level: 1, name: /Your network/ })
      .waitFor();
    await page.getByRole("tab", { name: "Bar controls", exact: true }).click();
    assert.equal(await page.locator("#example-controls").isVisible(), true);
    await page
      .getByRole("tab", { name: "Bar controls", exact: true })
      .press("ArrowRight");
    assert.equal(await page.locator("#example-popups").isVisible(), true);
    await page
      .getByRole("link", { name: "Start building", exact: false })
      .click();
    assert.match(await page.title(), /Get.*started/i);
  }));
test("API and styling docs expose real methods, tokens, and section anchors", () =>
  pageAt("docs/api/", async (page) => {
    for (const method of [
      "recordEvent",
      "addBarItem",
      "openPopup",
      "annotateMessage",
      "destroy",
    ])
      assert.match(
        await page.locator(".doc-content").textContent(),
        new RegExp(method),
      );
    await page
      .getByRole("navigation", { name: "Documentation", exact: true })
      .getByRole("link", { name: "Styling guide" })
      .click();
    assert.match(
      await page.locator(".doc-content").textContent(),
      /--brand-soft/,
    );
    assert.match(
      await page.locator(".doc-content").textContent(),
      /Shadow DOM/,
    );
    const toc = page.getByRole("navigation", { name: "On this page" });
    await toc.getByRole("link", { name: "Add an override stylesheet" }).click();
    assert.match(page.url(), /#add-an-override-stylesheet/);
  }));
test("hosted demo uses httpbin and keeps generic user events and custom controls", () =>
  pageAt("demo/", async (page) => {
    await page.route("https://httpbin.org/anything", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: {
            message: "Hello from a synthetic response",
            items: [{ id: 1 }, { id: 2 }],
          },
        }),
      }),
    );
    await page
      .getByRole("button", { name: "Fetch example JSON", exact: true })
      .click();
    await page.getByRole("button", { name: /POST \/anything/ }).waitFor();
    assert.match(await page.locator("#result").textContent(), /httpbin.org/);
    await page.getByLabel("Demo environment").selectOption("Preview");
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page.getByRole("button", { name: /Saved a draft/ }).waitFor();
    assert.match(
      await page.locator("#network-items").textContent(),
      /3 app events/,
    );
    await page.getByRole("button", { name: "Connection · ready" }).click();
    assert.match(
      await page.getByRole("dialog").textContent(),
      /Environment: Preview/,
    );
  }));
test("httpbin failures visibly fall back to bundled data without a server endpoint", () =>
  pageAt("demo/", async (page) => {
    await page.route("https://httpbin.org/anything", (route) => route.abort());
    await page
      .getByRole("button", { name: "Fetch example JSON", exact: true })
      .click();
    await page.getByRole("button", { name: /GET .*\/sample\.json/ }).waitFor();
    assert.match(
      await page.locator("#result").textContent(),
      /Bundled sample · httpbin unavailable/,
    );
  }));
test("landing, docs, and demo fit a narrow viewport", async () => {
  for (const path of [
    "",
    "docs/api/",
    "docs/styling/",
    "docs/react/",
    "docs/filtering/",
    "demo/",
  ])
    await pageAt(path, async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    });
});

test("code blocks are highlighted at build time without changing copy text", () =>
  pageAt("docs/react/", async (page) => {
    assert.ok((await page.locator("pre code.hljs .hljs-keyword").count()) > 0);
    assert.match(
      await page.locator("pre code").first().textContent(),
      /import \{ NetworkInspector \}/,
    );
    assert.equal(await page.locator("script[src*=highlight]").count(), 0);
    await page
      .getByRole("navigation", { name: "Documentation", exact: true })
      .getByRole("link", { name: "Capture filters", exact: true })
      .click();
    assert.match(
      await page.locator(".doc-content").textContent(),
      /byHostnames/,
    );
    assert.ok((await page.locator("pre code.hljs .hljs-string").count()) > 0);
  }));
test("demo sends and receives WebSocket frames and disconnects cleanly", () =>
  pageAt("demo/", async (page) => {
    await page.routeWebSocket("wss://ws.postman-echo.com/raw", (socket) =>
      socket.onMessage((message) => socket.send(message)),
    );
    await page
      .getByRole("button", { name: "Connect WebSocket", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .getElementById("socket-result")
        .textContent.startsWith("Connected"),
    );
    await page
      .getByLabel("WebSocket message", { exact: true })
      .fill('{"message":"Echo from the demo"}');
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Echoed WebSocket message/ })
      .click();
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /Echo from the demo/,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.inspector.store.entries.filter((e) => e.kind === "message")
            .length,
      ),
      2,
    );
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .getElementById("socket-result")
        .textContent.startsWith("Disconnected"),
    );
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await page.getByRole("button", { name: /WebSocket disconnected/ }).click();
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /Close code/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .isDisabled(),
      true,
    );
  }));
test("demo shows an unavailable WebSocket service and permits retry", () =>
  pageAt("demo/", async (page) => {
    await page.context().setOffline(true);
    await page
      .getByRole("button", { name: "Connect WebSocket", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.getElementById("socket-connect").disabled,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .isDisabled(),
      true,
    );
    assert.match(
      await page.locator("#socket-result").textContent(),
      /Disconnected|unavailable/,
    );
  }));

test("syntax colors remain readable on documentation code surfaces", () =>
  pageAt("docs/react/", async (page) => {
    const contrast = await page.evaluate(() => {
      const luminance = (color) => {
        const values = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => v / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      return [...document.querySelectorAll("pre code.hljs span")].map(
        (token) => {
          const a = luminance(getComputedStyle(token).color),
            b = luminance(
              getComputedStyle(token.closest("pre")).backgroundColor,
            );
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        },
      );
    });
    assert.ok(contrast.length > 0);
    assert.ok(
      contrast.every((ratio) => ratio >= 4.5),
      "Highlighted text must meet normal-text contrast",
    );
  }));

test("Open Regard preferences sync between site pages and the demo inspector", async () => {
  const context = await browser.newContext();
  const home = await context.newPage();
  const docs = await context.newPage();
  const demo = await context.newPage();
  try {
    await home.goto(origin + base);
    await home.getByLabel("Display preferences").selectOption("vision");
    await docs.goto(origin + base + "docs/");
    assert.equal(
      await docs.locator("html").getAttribute("data-regard-profile"),
      "vision",
    );
    assert.equal(
      await docs.getByLabel("Display preferences").inputValue(),
      "vision",
    );
    assert.equal(
      await docs
        .locator("html")
        .evaluate((node) => getComputedStyle(node).fontSize),
      "20px",
    );
    await demo.goto(origin + base + "demo/");
    await demo.getByLabel("Display preferences").selectOption("contrast");
    await home.waitForFunction(
      () => document.documentElement.dataset.regardProfile === "contrast",
    );
    await docs.waitForFunction(
      () => document.documentElement.dataset.regardProfile === "contrast",
    );
    assert.equal(
      await home.getByLabel("Display preferences").inputValue(),
      "contrast",
    );
    await demo.getByRole("button", { name: /Display · Contrast/ }).click();
    const detail = demo.frameLocator(".network-detail-frame");
    assert.match(await detail.locator("body").textContent(), /openregard/);
    assert.equal(
      await detail
        .locator("body")
        .evaluate((node) => getComputedStyle(node).fontSize),
      "15px",
    );
    await demo.reload();
    assert.equal(
      await demo.getByLabel("Display preferences").inputValue(),
      "contrast",
    );
    for (const page of [home, docs, demo]) {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        page.url() +
          JSON.stringify(
            await page.evaluate(() =>
              Array.from(document.querySelectorAll("body *"))
                .filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
                .slice(0, 12)
                .map((n) => [
                  n.tagName,
                  n.className,
                  n.getBoundingClientRect().right,
                ]),
            ),
          ),
      );
    }
  } finally {
    await context.close();
  }
});

test("demo uses a versioned runtime so cached releases cannot mix scripts", async () => {
  const { document } = parseHTML(
    await readFile(resolve(output, "demo/index.html"), "utf8"),
  );
  const script = document.querySelector('script[type="module"]');
  assert.match(script.getAttribute("src"), /demo\.js\?v=[a-f0-9]{12}/);
  const source = await readFile(resolve(output, "demo/demo.js"), "utf8");
  assert.match(source, /\.\.\/runtime-[a-f0-9]{12}\/index.js/);
  assert.doesNotMatch(source, /\.\.\/src\//);
});
