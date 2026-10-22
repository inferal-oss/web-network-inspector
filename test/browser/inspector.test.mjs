import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createExampleServer } from "../../scripts/serve.mjs";

async function fixture(run) {
  const server = createExampleServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.routeWebSocket("**/messages", (socket) =>
      socket.onMessage((message) => socket.send(`echo:${message}`)),
    );
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://httpbin.org/anything", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          json: {
            message: "Hello from a synthetic response",
            items: [
              { id: 1, name: "Blue" },
              { id: 2, name: "Green" },
            ],
          },
        }),
      }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.inspector);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
test("real browser captures fetch and generic events; selected rows hold through live traffic", () =>
  fixture(async (page) => {
    await page
      .getByRole("button", { name: "Fetch example JSON", exact: true })
      .click();
    await page.getByRole("button", { name: /POST \/anything/ }).waitFor();
    const host = page
      .getByRole("button", { name: /POST \/anything/ })
      .locator(".network-row-host");
    assert.equal(await host.textContent(), "httpbin.org");
    assert.equal(await host.isVisible(), true);
    await page.getByRole("button", { name: /POST \/anything/ }).click();
    await page
      .frameLocator(".network-detail-frame")
      .locator("body")
      .locator(".network-json-tree")
      .first()
      .waitFor();
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /Hello from a synthetic response/,
    );
    const before = await page.locator(".network-row").count();
    await page.evaluate(() => {
      for (let i = 0; i < 230; i++)
        window.inspector.recordEvent({
          type: "custom.tick",
          label: `Synthetic event ${i}`,
          data: `tick ${i}`,
        });
    });
    await page.waitForFunction(
      () =>
        window.inspector.root
          .getElementById("network-latest")
          .textContent.match(/^(\d+) new/)?.[1] >= 230,
    );
    assert.equal(await page.locator(".network-row").count(), before);
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /Hello from a synthetic response/,
    );
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    assert.equal(await page.locator(".network-row").count(), 200);
    await page.getByRole("searchbox").fill("Synthetic event 229");
    await page.waitForFunction(
      () => window.inspector.root.querySelectorAll(".network-row").length === 1,
    );
    assert.match(
      await page.locator(".network-row").textContent(),
      /Synthetic event 229/,
    );
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    assert.equal(await page.locator(".network-row").count(), 0);
  }));
test("generic bar popup supports keyboard close, focus restoration, custom content and updates", () =>
  fixture(async (page) => {
    const bar = page.getByRole("button", { name: "Connection · ready" });
    await bar.click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await bar.getAttribute("aria-expanded"), "true");
    await page
      .getByRole("button", { name: "Close popup", exact: true })
      .press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await bar.evaluate((node) => node === node.getRootNode().activeElement),
      true,
    );
    await bar.click();
    await page.getByRole("button", { name: "Record a check" }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page
      .getByRole("button", { name: /Checked example connection/ })
      .waitFor();
    await page.evaluate(() => {
      const item = window.inspector.addBarItem({
        id: "custom",
        label: "Custom",
      });
      item.update({ label: "Updated" });
      window.customItem = item;
      window.customPopup = window.inspector.openPopup({
        title: "Text only",
        content: "<script>bad()</script>",
        anchor: item.element,
      });
    });
    assert.equal(await page.getByRole("dialog").locator("script").count(), 0);
    assert.match(await page.getByRole("dialog").textContent(), /<script>/);
    await page.evaluate(() =>
      window.customPopup.update({
        title: "Replaced",
        content: "Fresh content",
      }),
    );
    assert.match(
      await page.getByRole("dialog").textContent(),
      /Replaced.*Fresh content/s,
    );
    await page.evaluate(() => window.customItem.remove());
    assert.equal(await page.getByRole("dialog").count(), 0);
  }));
test("resize, collapse, pause and destroy work on a narrow viewport without leaking global styles", () =>
  fixture(async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const resizer = page.getByRole("separator", {
      name: /^Resize network activity/,
    });
    const before = Number(await resizer.getAttribute("aria-valuenow"));
    await resizer.focus();
    await resizer.press("ArrowUp");
    assert.ok(Number(await resizer.getAttribute("aria-valuenow")) > before);
    await page
      .getByRole("button", { name: "Pause recording", exact: true })
      .click();
    const count = await page.evaluate(
      () => window.inspector.store.entries.length,
    );
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => window.inspector.store.entries.length),
      count,
    );
    await page
      .getByRole("button", { name: "Resume recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Collapse network activity", exact: true })
      .click();
    assert.equal(await page.locator("#network-body").isVisible(), false);
    assert.equal(
      await page.evaluate(() => document.querySelector("#network-body")),
      null,
    );
    await page.evaluate(() => {
      window.inspector.destroy();
      window.inspector.destroy();
    });
    assert.equal(await page.locator("[data-web-network-inspector]").count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
  }));

test("browser WebSocket frames and XHR responses keep native behavior and generic annotations", () =>
  fixture(async (page) => {
    const result = await page.evaluate(async () => {
      window.inspector.store.clear();
      const socket = new WebSocket(`ws://${location.host}/messages`);
      await new Promise((resolve) =>
        socket.addEventListener("open", resolve, { once: true }),
      );
      const received = new Promise((resolve) =>
        socket.addEventListener(
          "message",
          (event) => {
            window.inspector.annotateMessage(socket, "in", {
              type: "custom.reply",
              correlationId: "example",
            });
            resolve(event.data);
          },
          { once: true },
        ),
      );
      socket.send("hello");
      window.inspector.annotateMessage(socket, "out", {
        type: "custom.send",
        correlationId: "example",
      });
      const reply = await received;
      socket.close();
      const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/echo");
        xhr.onload = () => resolve(JSON.parse(xhr.responseText));
        xhr.onerror = reject;
        xhr.send();
      });
      return { reply, response };
    });
    assert.equal(result.reply, "echo:hello");
    assert.equal(result.response.items.length, 2);
    await page.waitForFunction(() =>
      window.inspector.store.entries.some(
        (entry) => entry.transport === "XHR" && entry.responseBody,
      ),
    );
    const entries = await page.evaluate(() =>
      window.inspector.store.entries.map(
        ({ kind, protocol, correlationId, transport }) => ({
          kind,
          protocol,
          correlationId,
          transport,
        }),
      ),
    );
    assert.equal(entries.filter((entry) => entry.kind === "message").length, 2);
    assert.deepEqual(
      entries
        .filter((entry) => entry.kind === "message")
        .map((entry) => entry.protocol),
      ["custom.send", "custom.reply"],
    );
    assert.equal(
      entries.find((entry) => entry.transport === "XHR").kind,
      "http",
    );
  }));

test("example server serves only public source and example assets", () =>
  fixture(async (page) => {
    for (const path of [
      "/.git/config",
      "/package.json",
      "/src/%2e%2e%2f.git/config",
      "/examples/%2e%2e%2fpackage.json",
    ]) {
      const response = await page.request.get(new URL(path, page.url()).href);
      assert.equal(response.status(), 404);
    }
    assert.equal(
      (
        await page.request.get(new URL("/src/style.css", page.url()).href)
      ).status(),
      200,
    );
  }));

test("demo interactions record user labels and custom bar changes", () =>
  fixture(async (page) => {
    await page.getByLabel("Demo environment").selectOption("Preview");
    await page
      .getByLabel("Event label", { exact: true })
      .fill("Published a preview");
    await page.getByLabel("Level", { exact: true }).selectOption("success");
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page.getByRole("button", { name: /Published a preview/ }).waitFor();
    assert.match(
      await page.locator("#network-items").textContent(),
      /2 app events/,
    );
    await page.getByRole("button", { name: /Published a preview/ }).click();
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /demo.note/,
    );
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /"environment": "Preview"/,
    );
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /"level": "success"/,
    );
    await page.getByRole("button", { name: "Connection · ready" }).click();
    assert.match(
      await page.getByRole("dialog").textContent(),
      /Environment: Preview/,
    );
    await page
      .getByRole("button", { name: "Record a check", exact: true })
      .click();
    assert.match(
      await page.locator("#network-items").textContent(),
      /3 app events/,
    );
  }));

test("iterable headers reach the server and remain visible in capture", () =>
  fixture(async (page) => {
    let sent;
    await page.route("**/echo", async (route) => {
      sent = {
        headers: await route.request().allHeaders(),
        method: route.request().method(),
        body: route.request().postData(),
      };
      await route.continue();
    });
    const result = await page.evaluate(async () => {
      const headers = (function* () {
        yield ["x-demo", "present"];
        yield ["content-type", "application/json"];
      })();
      const init = Object.freeze(
        Object.create(
          { method: "POST" },
          {
            headers: { value: headers, enumerable: true },
            body: { value: '{"message":"hello"}', enumerable: true },
          },
        ),
      );
      const response = await fetch("/echo", init);
      const entry = window.inspector.store.entries.findLast(
        (item) => item.kind === "http",
      );
      return { status: response.status, captured: entry.requestHeaders };
    });
    assert.equal(result.status, 200);
    assert.equal(sent.headers["x-demo"], "present");
    assert.equal(sent.headers["content-type"], "application/json");
    assert.equal(sent.method, "POST");
    assert.equal(sent.body, '{"message":"hello"}');
    assert.match(result.captured, /x-demo: present/);
  }));

test("capture identifies requests from the inspected window and other windows without reading their streams", () =>
  fixture(async (page) => {
    const delivered = [];
    await page.route("**/echo?request=*", async (route) => {
      delivered.push({
        url: route.request().url(),
        method: route.request().method(),
        headers: await route.request().allHeaders(),
        body: route.request().postData(),
      });
      await route.continue();
    });
    const result = await page.evaluate(async () => {
      const { installNetworkCapture } = await import("/src/network-capture.js");
      const frames = [];
      let capture;
      try {
        for (let i = 0; i < 2; i++) {
          const frame = document.createElement("iframe");
          const loaded = new Promise((resolve) =>
            frame.addEventListener("load", resolve, { once: true }),
          );
          frame.src = "/echo";
          document.body.append(frame);
          frames.push(frame);
          await loaded;
        }
        const target = frames[0].contentWindow;
        const nativeFetch = target.fetch;
        const before = [];
        target.fetch = function (input, init) {
          before.push({ bodyUsed: input.bodyUsed, locked: input.body.locked });
          return nativeFetch.call(this, input, init);
        };
        capture = installNetworkCapture(target);
        const constructors = [
          target.Request,
          window.Request,
          frames[1].contentWindow.Request,
        ];
        for (let i = 0; i < constructors.length; i++) {
          const request = new constructors[i](
            new URL(`/echo?request=${i}`, location.href),
            {
              method: "POST",
              headers: { "x-demo": `window-${i}` },
              body: `message-${i}`,
            },
          );
          await target.fetch(request);
        }
        return {
          before,
          entries: capture.store.entries
            .filter((entry) => entry.kind === "http")
            .map((entry) => ({
              url: entry.url,
              method: entry.method,
              headers: entry.requestHeaders,
              note: entry.requestBody?.note,
            })),
        };
      } finally {
        capture?.disconnect();
        for (const frame of frames) frame.remove();
      }
    });
    assert.equal(delivered.length, 3);
    assert.equal(result.entries.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(result.before[i].bodyUsed, false);
      assert.equal(result.before[i].locked, false);
      assert.equal(delivered[i].method, "POST");
      assert.equal(delivered[i].headers["x-demo"], `window-${i}`);
      assert.equal(delivered[i].body, `message-${i}`);
      assert.equal(result.entries[i].url, delivered[i].url);
      assert.equal(result.entries[i].method, "POST");
      assert.match(
        result.entries[i].headers,
        new RegExp(`x-demo: window-${i}`),
      );
      assert.match(result.entries[i].note, /not read/);
    }
  }));

test("popup cleanup and ownership survive synchronous rendering and independent custom controls", () =>
  fixture(async (page) => {
    const result = await page.evaluate(() => {
      const inspector = window.inspector;
      let disposed = 0;
      const closed = inspector.openPopup({
        content: ({ close }) => {
          close();
          return () => disposed++;
        },
      });
      const group = document.createElement("div"),
        anchor = document.createElement("button");
      anchor.textContent = "Nested popup control";
      group.append(anchor);
      const owner = inspector.addBarItem({ id: "nested", element: group });
      const disclosure = document.createElement("button");
      disclosure.setAttribute("aria-expanded", "true");
      const other = inspector.addBarItem({
        id: "disclosure",
        element: disclosure,
      });
      const popup = inspector.openPopup({ anchor, content: "Owned popup" });
      other.remove();
      const stillOpen = popup.element.isConnected;
      owner.remove();
      return {
        disposed,
        closed: closed.element.isConnected,
        stillOpen,
        removed: popup.element.isConnected,
        anchorExpanded: anchor.getAttribute("aria-expanded"),
      };
    });
    assert.deepEqual(result, {
      disposed: 1,
      closed: false,
      stillOpen: true,
      removed: false,
      anchorExpanded: "false",
    });
  }));

test("resource details load headers and content in a sandboxed frame and persistence survives reload", () =>
  fixture(async (page) => {
    await page.getByRole("button", { name: /GET \/src\/style\.css/ }).click();
    const details = page.frameLocator(".network-detail-frame");

    await details
      .getByRole("heading", { name: /Loaded resource body/ })
      .waitFor();
    assert.match(
      await details.locator("body").textContent(),
      /content-type: text\/css/,
    );
    assert.match(await details.locator("body").textContent(), /:host/);
    const retained = await page.evaluate(async () => {
      const entry = window.inspector.store.entries.find(
        (entry) =>
          entry.kind === "resource" && entry.url.endsWith("/src/style.css"),
      );
      await window.inspector.store.persistence.flush();
      return {
        body: entry.resourceBody.bytes.length,
        headers: entry.resourceResponseHeaders,
      };
    });
    assert.ok(retained.body > 100);
    assert.equal(
      await details
        .getByRole("button", { name: "Load resource preview", exact: true })
        .count(),
      0,
    );
    assert.match(
      await details
        .locator("body")
        .evaluate((node) => getComputedStyle(node).fontFamily),
      /system-ui|sans-serif/,
    );
    await page.reload();
    await page.waitForFunction(() => window.inspector);
    const restored = await page.evaluate(() => {
      const entry = window.inspector.store.entries.find(
        (entry) => entry.restored && entry.resourceBody,
      );
      return (
        entry && {
          body: entry.resourceBody.bytes.length,
          headers: entry.resourceResponseHeaders,
        }
      );
    });
    assert.deepEqual(restored, retained);
    assert.equal(
      await page.locator(".network-detail-frame").getAttribute("sandbox"),
      "allow-same-origin",
    );
  }));

test("content-type renderer isolates HTML and shows images; custom details get an iframe and cleanup", () =>
  fixture(async (page) => {
    await page.evaluate(async () => {
      const { bodyPreview } = await import("/src/index.js");
      const entry = window.inspector.store.add({
        kind: "http",
        method: "GET",
        url: "https://example.com/preview",
        status: 200,
      });
      window.inspector.store.preview(
        entry,
        "responseBody",
        bodyPreview(
          '<h1>Preview heading</h1><script>parent.document.body.dataset.injected="yes"</script><img src="https://example.com/should-not-load">',
          10000,
          "text/html",
        ),
      );
    });
    await page.getByRole("button", { name: /GET \/preview/ }).click();
    const details = page.frameLocator(".network-detail-frame");
    await details
      .frameLocator(".network-html-preview")
      .getByRole("heading", { name: "Preview heading" })
      .waitFor();
    assert.equal(
      await details.locator(".network-html-preview").getAttribute("sandbox"),
      "",
    );
    assert.equal(
      await page.evaluate(() => document.body.dataset.injected),
      undefined,
    );
    await page.evaluate(async () => {
      const { createInspector, NetworkCapture, bodyPreview } = await import(
        "/src/index.js"
      );
      window.inspector.destroy();
      const store = new NetworkCapture();
      window.cleanups = 0;
      window.inspector = createInspector({
        capture: false,
        store,
        open: true,
        renderDetails: (context) => {
          window.hasRendererFrame = context.iframe instanceof HTMLIFrameElement;
          context.renderDefault();
          const label = context.document.createElement("p");
          label.textContent = "Custom details extension";
          context.container.append(label);
          return () => window.cleanups++;
        },
      });
      const entry = store.add({
        kind: "http",
        method: "GET",
        url: "https://example.com/image",
        status: 200,
      });
      const binary = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1cAAAAASUVORK5CYII=",
        ),
        (c) => c.charCodeAt(0),
      );
      store.preview(
        entry,
        "responseBody",
        bodyPreview(binary, 10000, "image/png"),
      );
    });
    await page.mouse.move(0, 0);
    await page.getByRole("button", { name: /GET \/image/ }).click();
    await details.getByRole("img", { name: "Response body preview" }).waitFor();
    await details.getByText("Custom details extension").waitFor();
    assert.equal(await page.evaluate(() => window.hasRendererFrame), true);
    const before = await page.evaluate(() => window.cleanups);
    await page.evaluate(() => window.inspector.destroy());
    assert.equal(await page.evaluate(() => window.cleanups), before + 1);
  }));

test("columns resize by pointer and keyboard, expose HTTP codes, and support custom controls with cleanup", () =>
  fixture(async (page) => {
    await page
      .getByRole("button", { name: "Fetch example JSON", exact: true })
      .click();
    const request = page.getByRole("button", { name: /POST \/anything/ });
    await request
      .locator('[data-column="code"]')
      .getByText("200", { exact: true })
      .waitFor();
    const grip = page.getByRole("separator", {
      name: "Resize Request / event column",
      exact: true,
    });
    await grip.focus();
    await grip.press("ArrowRight");
    assert.equal(await grip.getAttribute("aria-valuenow"), "330");
    const box = await grip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2);
    await page.mouse.up();
    assert.equal(await grip.getAttribute("aria-valuenow"), "450");
    assert.equal(
      await request
        .locator('[data-column="hostPath"]')
        .evaluate((n) => Math.round(n.getBoundingClientRect().width)),
      450,
    );
    await page
      .getByRole("button", { name: "Try custom columns", exact: true })
      .click();
    assert.equal(
      await request
        .locator('[data-column="insight"]')
        .locator(".demo-insight-meta")
        .textContent(),
      "111 B · json",
    );
    await page
      .getByRole("button", { name: "Hide Activity Insight", exact: true })
      .click();
    assert.equal(await request.locator('[data-column="insight"]').count(), 0);
    await page.evaluate(() => {
      window.columnClicks = 0;
      window.columnCleanups = 0;
      window.columnRenders = 0;
      window.inspector.store.clear();
      window.inspector.setColumns([
        {
          id: "action",
          label: "Action",
          width: 180,
          render(entry, { container, document }) {
            window.columnRenders++;
            const button = document.createElement("button");
            button.textContent = "Custom action " + entry.label;
            button.addEventListener("click", () => window.columnClicks++);
            container.append(button);
            return () => window.columnCleanups++;
          },
        },
      ]);
      window.columnEntry = window.inspector.recordEvent({
        label: "One",
        data: "payload",
      });
    });
    await page
      .getByRole("button", { name: "Custom action One", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.columnClicks), 1);
    assert.equal(
      await page.locator('.network-row[aria-pressed="true"]').count(),
      0,
    );
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    const renders = await page.evaluate(() => window.columnRenders);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.columnRenders), renders);
    await page.evaluate(() =>
      window.inspector.store.update(window.columnEntry, { label: "Two" }),
    );
    await page
      .getByRole("button", { name: "Custom action Two", exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => window.columnCleanups), 1);
    const invalid = await page.evaluate(() => {
      try {
        window.inspector.setColumns([]);
        return false;
      } catch {
        return window.inspector.getColumns()[0].id === "action";
      }
    });
    assert.equal(invalid, true);
    await page.locator(".network-row").focus();
    await page.locator(".network-row").press("Enter");
    await page.evaluate(() => {
      window.inspector.store.setLimits({ entries: 1 });
      window.inspector.recordEvent({ label: "Replacement" });
    });
    await page
      .locator('.network-row [data-column="action"]')
      .getByText("Expired", { exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => window.columnCleanups), 2);
    await page.evaluate(() => window.inspector.destroy());
    assert.equal(await page.evaluate(() => window.columnCleanups), 2);
  }));

test("default previews color CSS, Python, and escaped HTML source without changing source text", () =>
  fixture(async (page) => {
    await page.evaluate(async () => {
      const { bodyPreview } = await import("/src/index.js");
      window.inspector.store.clear();
      for (const [path, contentType, text] of [
        ["style.css", "text/css", "body { color: red; margin: 12px; }"],
        [
          "example.py",
          "text/x-python",
          'def greet(name):\n    return "Hello " + name',
        ],
        [
          "markup.html",
          "text/html",
          '<img src=x onerror="window.injected=true"><script>window.injected=true</script>',
        ],
      ]) {
        const entry = window.inspector.store.add({
          kind: "http",
          method: "GET",
          url: "https://example.com/" + path,
          status: 200,
        });
        window.inspector.store.preview(
          entry,
          "responseBody",
          bodyPreview(text, 10000, contentType),
        );
      }
    });
    const details = page.frameLocator(".network-detail-frame");
    for (const [path, language, text] of [
      ["style.css", "css", "body { color: red; margin: 12px; }"],
      ["example.py", "python", 'def greet(name):\n    return "Hello " + name'],
      [
        "markup.html",
        "xml",
        '<img src=x onerror="window.injected=true"><script>window.injected=true</script>',
      ],
    ]) {
      await page
        .getByRole("button", { name: new RegExp("GET /" + path) })
        .click();
      const pre = details.locator(`pre.hljs[data-language="${language}"]`);
      await pre.waitFor();
      assert.equal(await pre.textContent(), text);
      assert.ok((await pre.locator('span[class^="hljs-"]').count()) > 0);
      assert.equal(await pre.locator("img,script").count(), 0);
    }
    assert.equal(await page.evaluate(() => window.injected), undefined);
  }));

test("each column can enable a comparator or disable sorting; direction cycles and errors do not interrupt capture", () =>
  fixture(async (page) => {
    await page.evaluate(() => {
      window.inspector.store.clear();
      window.inspector.setColumns([
        {
          id: "label",
          label: "Label",
          width: 240,
          render: (entry) => entry.label,
          sort: (a, b) => a.label.localeCompare(b.label),
        },
      ]);
      for (const label of ["Bravo", "Alpha", "Charlie"])
        window.inspector.recordEvent({ label });
    });
    await page
      .getByLabel("Activity type", { exact: true })
      .selectOption("event");
    const sorter = page.locator('[data-sort-column="label"]');
    await sorter.click();
    assert.deepEqual(
      await page
        .locator('.network-row [data-column="label"]')
        .allTextContents(),
      ["Charlie", "Bravo", "Alpha"],
    );
    await sorter.click();
    assert.deepEqual(
      await page
        .locator('.network-row [data-column="label"]')
        .allTextContents(),
      ["Alpha", "Bravo", "Charlie"],
    );
    await sorter.click();
    assert.deepEqual(
      await page
        .locator('.network-row [data-column="label"]')
        .allTextContents(),
      ["Bravo", "Alpha", "Charlie"],
    );
    await page.evaluate(() => {
      const columns = window.inspector.getColumns();
      window.inspector.setColumns(columns.map((c) => ({ ...c, sort: false })));
    });
    assert.equal(await page.locator('[data-sort-column="label"]').count(), 0);
    await page.evaluate(() =>
      window.inspector.setColumns([
        {
          id: "bad",
          label: "Bad",
          width: 200,
          render: (e) => e.label,
          sort: () => {
            throw Error("Example comparator failure");
          },
        },
      ]),
    );
    await page.locator('[data-sort-column="bad"]').click();
    await page
      .locator("#network-summary")
      .getByText(/Sort failed: Example comparator failure/)
      .waitFor();
    await page.evaluate(() =>
      window.inspector.setColumns([
        {
          id: "null-error",
          label: "Null error",
          width: 180,
          render: (e) => e.label,
          sort: () => {
            throw null;
          },
        },
      ]),
    );
    await page.locator('[data-sort-column="null-error"]').click();
    assert.match(
      await page.locator("#network-summary").textContent(),
      /Sort failed: null/,
    );
    await page.evaluate(() =>
      window.inspector.recordEvent({ label: "Recording continues" }),
    );
    assert.equal(
      await page.evaluate(() =>
        window.inspector.store.entries.some(
          (e) => e.label === "Recording continues",
        ),
      ),
      true,
    );
  }));

test("demo visibility controls compose default and colorful custom columns and keep one column visible", () =>
  fixture(async (page) => {
    const choices = page.getByRole("group", {
      name: "Visible columns",
      exact: true,
    });
    await choices.getByLabel("Status", { exact: true }).uncheck();
    await choices.getByLabel("HTTP code", { exact: true }).uncheck();
    assert.equal(
      await page
        .getByRole("separator", { name: "Resize Status column", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Try custom columns", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("separator", {
          name: "Resize Activity Insight column",
          exact: true,
        })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    const cell = page
      .getByRole("button", { name: /Saved a draft/ })
      .locator('[data-column="insight"]');
    await cell.locator('[data-tone="pink"]').waitFor();
    assert.match(await cell.textContent(), /demo.note.*demo-session/);
    assert.notEqual(
      await cell
        .locator(".demo-insight-badge")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await page.getByLabel("Insight sorting", { exact: true }).uncheck();
    assert.equal(await page.locator('[data-sort-column="insight"]').count(), 0);
    await page.getByLabel("Insight sorting", { exact: true }).check();
    assert.equal(await page.locator('[data-sort-column="insight"]').count(), 1);
    await page.getByLabel("Size sorting", { exact: true }).uncheck();
    assert.equal(await page.locator('[data-sort-column="size"]').count(), 0);
    for (const name of ["Request / event", "Size", "Waterfall"])
      await choices.getByLabel(name, { exact: true }).uncheck();
    assert.equal(
      await choices.getByLabel("Activity Insight", { exact: true }).isEnabled(),
      false,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Hide Activity Insight", exact: true })
        .isEnabled(),
      false,
    );
    await page
      .getByRole("button", { name: "Reset columns", exact: true })
      .click();
    assert.equal(await page.locator(".network-column-resize").count(), 5);
    assert.equal(await page.locator('[data-sort-column="size"]').count(), 1);
    assert.equal(
      await choices.getByLabel("Status", { exact: true }).isChecked(),
      true,
    );
  }));

test("demo restores visibility, widths, sort direction, sort opt-outs, and history setting on reload", () =>
  fixture(async (page) => {
    const choices = page.getByRole("group", {
      name: "Visible columns",
      exact: true,
    });
    await page
      .getByRole("button", { name: "Try custom columns", exact: true })
      .click();
    await choices.getByLabel("Status", { exact: true }).uncheck();
    await page.getByLabel("Size sorting", { exact: true }).uncheck();
    const grip = page.getByRole("separator", {
      name: "Resize Request / event column",
      exact: true,
    });
    await grip.press("Shift+ArrowRight");
    await grip.press("ArrowRight");
    await page.getByLabel("Previous page loads", { exact: true }).uncheck();
    const sorter = page.locator('[data-sort-column="insight"]');
    await sorter.click();
    await sorter.click();
    await page.reload();
    await page.waitForFunction(() => window.inspector);
    assert.equal(
      await choices.getByLabel("Status", { exact: true }).isChecked(),
      false,
    );
    assert.equal(
      await choices.getByLabel("Activity Insight", { exact: true }).isChecked(),
      true,
    );
    assert.equal(await grip.getAttribute("aria-valuenow"), "380");
    assert.equal(await page.locator('[data-sort-column="size"]').count(), 0);
    assert.match(await sorter.getAttribute("aria-label"), /ascending/);
    assert.equal(
      await page.getByLabel("Previous page loads", { exact: true }).isChecked(),
      false,
    );
    assert.equal(
      await page.evaluate(
        () => window.inspector.getColumns().find((c) => c.id === "size").sort,
      ),
      false,
    );
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("web-network-inspector-demo:view-v1")),
    );
    assert.equal(saved.version, 1);
    assert.equal(saved.sorting.id, "insight");
    assert.equal(JSON.stringify(saved).includes("requestBody"), false);
    await page
      .getByRole("button", { name: "Reset columns", exact: true })
      .click();
    await page.evaluate(() => window.inspector.preferences.flush());
    await page.reload();
    await page.waitForFunction(() => window.inspector);
    assert.equal(await grip.getAttribute("aria-valuenow"), "320");
    assert.equal(
      await choices.getByLabel("Status", { exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await choices.getByLabel("Activity Insight", { exact: true }).isChecked(),
      false,
    );
  }));

test("previous-page checkbox hides restored rows and selection without deleting retained data", () =>
  fixture(async (page) => {
    await page.evaluate(() => {
      window.inspector.store.clear();
      window.inspector.store.add({
        kind: "event",
        eventType: "old",
        label: "Old retained event",
        restored: true,
        start: -1000,
        end: -1000,
      });
      window.inspector.recordEvent({ label: "Current page event" });
    });
    await page.getByRole("button", { name: /Old retained event/ }).click();
    await page.getByLabel("Previous page loads", { exact: true }).uncheck();
    assert.equal(
      await page.getByRole("button", { name: /Old retained event/ }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: /Current page event/ }).count(),
      1,
    );
    assert.match(
      await page
        .frameLocator(".network-detail-frame")
        .locator("body")
        .textContent(),
      /Select a request/,
    );
    assert.equal(
      await page.evaluate(() =>
        window.inspector.store.entries.some(
          (e) => e.label === "Old retained event",
        ),
      ),
      true,
    );
    await page.getByLabel("Previous page loads", { exact: true }).check();
    await page.getByRole("button", { name: /Old retained event/ }).waitFor();
    assert.equal(await page.locator("#network-range").textContent(), "");
  }));

test("persistent inspector supports asynchronous custom storage and reports unavailable storage", () =>
  fixture(async (page) => {
    const result = await page.evaluate(async () => {
      const { createPersistentInspector, defaultColumns } = await import(
        "/src/index.js"
      );
      window.inspector.destroy();
      let saved = {
        version: 1,
        columns: [
          { id: "hostPath", width: 510, hidden: false },
          { id: "size", hidden: true },
        ],
        sorting: null,
        includePreviousPageLoads: false,
      };
      let closed = 0;
      const storage = {
        async load() {
          await new Promise((r) => setTimeout(r, 10));
          return saved;
        },
        async save(value) {
          await new Promise((r) => setTimeout(r, 10));
          saved = value;
        },
        async close() {
          closed++;
        },
      };
      window.inspector = await createPersistentInspector({
        capture: false,
        open: true,
        storage,
        columns: defaultColumns,
      });
      const initial = window.inspector.getViewState();
      window.inspector.setIncludePreviousPageLoads(true);
      await window.inspector.preferences.flush();
      const updated = saved;
      await window.inspector.preferences.close();
      window.inspector.destroy();
      window.inspector = await createPersistentInspector({
        capture: false,
        storage: {
          load() {
            throw Error("Blocked storage");
          },
          save() {
            throw Error("Blocked storage");
          },
        },
      });
      return {
        initial,
        updated,
        closed,
        status: window.inspector.preferences.status,
        error: window.inspector.preferences.error,
      };
    });
    assert.equal(
      result.initial.columns.find((c) => c.id === "hostPath").width,
      510,
    );
    assert.equal(
      result.initial.columns.find((c) => c.id === "size").hidden,
      true,
    );
    assert.equal(result.initial.includePreviousPageLoads, false);
    assert.equal(result.updated.includePreviousPageLoads, true);
    assert.equal(result.closed, 1);
    assert.equal(result.status, "Unavailable");
    assert.match(result.error, /Blocked storage/);
  }));

test("demo custom details render an application summary and keep default headers and body", () =>
  fixture(async (page) => {
    await page.getByLabel("Level", { exact: true }).selectOption("warning");
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page.getByRole("button", { name: /Saved a draft/ }).click();
    const details = page.frameLocator(".network-detail-frame");
    const summary = details.getByRole("region", {
      name: "Custom application summary",
      exact: true,
    });
    await summary.waitFor();
    assert.match(
      await summary.textContent(),
      /CUSTOM DETAILS RENDERER.*Saved a draft.*Level: warning.*Environment: Sandbox/,
    );
    assert.equal(await details.locator(".network-json-tree").count(), 1);
    await page
      .getByRole("button", { name: "Fetch example JSON", exact: true })
      .click();
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await page.getByRole("button", { name: /POST \/anything/ }).click();
    await summary.waitFor();
    assert.match(
      await details.locator("body").textContent(),
      /Request headers.*Response headers.*Response body/s,
    );
    assert.equal(await details.locator(".demo-detail-card").count(), 1);
  }));

test("demo theme updates host, selected details, persists, and respects display contrast", () =>
  fixture(async (page) => {
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page.getByRole("button", { name: /Saved a draft/ }).click();
    const frame = page.frameLocator(".network-detail-frame");
    await frame
      .getByRole("region", { name: "Custom application summary" })
      .waitFor();
    const theme = page.getByRole("checkbox", {
      name: "Use the custom Plum theme",
      exact: true,
    });
    await theme.check();
    const colors = () =>
      page.evaluate(() => {
        const api = window.inspector;
        return [
          getComputedStyle(api.host).getPropertyValue("--brand").trim(),
          getComputedStyle(
            api.root.querySelector(".network-detail-frame").contentDocument
              .documentElement,
          )
            .getPropertyValue("--brand")
            .trim(),
        ];
      });
    assert.deepEqual(await colors(), ["#7c3aed", "#7c3aed"]);
    await page.reload();
    await page.waitForFunction(() => window.inspector);
    assert.equal(await theme.isChecked(), true);
    await page.getByRole("button", { name: /Saved a draft/ }).click();
    await frame
      .getByRole("region", { name: "Custom application summary" })
      .waitFor();
    await page.evaluate(() => window.inferalDisplay.setProfile("contrast"));
    assert.deepEqual(await colors(), ["#0645ad", "#0645ad"]);
    await page.evaluate(() => window.inferalDisplay.setProfile("standard"));
    assert.deepEqual(await colors(), ["#7c3aed", "#7c3aed"]);
    await theme.uncheck();
    assert.notEqual((await colors())[0], "#7c3aed");
    assert.equal((await colors())[0], (await colors())[1]);
  }));

test("Midnight themes custom columns, JSON and source previews, HTML canvases, and survives reload", () =>
  fixture(async (page) => {
    await page
      .getByRole("button", { name: "Try custom columns", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Use the dark Midnight theme",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page.getByRole("button", { name: /Saved a draft/ }).click();
    const frame = page.frameLocator(".network-detail-frame");
    await frame.locator(".network-json-string").first().waitFor();
    assert.equal(
      await frame
        .locator("body")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(20, 28, 43)",
    );
    assert.equal(
      await frame
        .locator(".network-json-string")
        .first()
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(155, 229, 197)",
    );
    const badge = page
      .locator('.demo-insight[data-tone="pink"] .demo-insight-badge')
      .first();
    assert.equal(
      await badge.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(71, 38, 63)",
    );
    assert.equal(
      await badge.evaluate((n) => getComputedStyle(n).color),
      "rgb(255, 182, 209)",
    );
    const contrast = await badge.evaluate((n) => {
      const luminance = (color) => {
        const [r, g, b] = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((x) => x / 255)
          .map((x) =>
            x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
          );
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const css = getComputedStyle(n),
        a = luminance(css.color),
        b = luminance(css.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    assert.ok(
      contrast >= 4.5,
      "Dark custom column text has normal-text contrast",
    );
    await page.route("**/dark-preview.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'const greeting = "Night"; // hello',
      }),
    );
    await page.evaluate(() => fetch("/dark-preview.js").then((r) => r.text()));
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await page.getByRole("button", { name: /GET \/dark-preview.js/ }).click();
    await frame.locator(".hljs-string").waitFor();
    assert.equal(
      await frame
        .locator(".hljs-string")
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(155, 229, 197)",
    );
    await page.route("**/dark-preview.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Night preview</h1><script>window.executed = true</script>",
      }),
    );
    await page.evaluate(() =>
      fetch("/dark-preview.html").then((r) => r.text()),
    );
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await page.getByRole("button", { name: /GET \/dark-preview.html/ }).click();
    const html = frame.frameLocator(".network-html-preview");
    await html.getByRole("heading", { name: "Night preview" }).waitFor();
    assert.equal(
      await html
        .locator("body")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(20, 28, 43)",
    );
    assert.equal(
      await frame.locator(".network-html-preview").getAttribute("sandbox"),
      "",
    );
    await page
      .getByRole("checkbox", { name: "Use custom details view", exact: true })
      .uncheck();
    assert.equal(await frame.locator(".demo-detail-card").count(), 0);
    await frame.locator(".network-html-preview").waitFor();
    await page
      .getByRole("checkbox", { name: "Use custom details view", exact: true })
      .check();
    await frame.locator(".demo-detail-card").waitFor();
    await page.evaluate(() => window.inferalDisplay.setProfile("contrast"));
    assert.equal(
      await frame
        .locator("body")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await page.evaluate(() => window.inferalDisplay.setProfile("standard"));
    assert.equal(
      await frame
        .locator("body")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(20, 28, 43)",
    );
    await page
      .getByRole("checkbox", { name: "Use custom details view", exact: true })
      .uncheck();
    await page.reload();
    await page.waitForFunction(() => window.inspector);
    assert.equal(
      await page
        .getByRole("checkbox", {
          name: "Use the dark Midnight theme",
          exact: true,
        })
        .isChecked(),
      true,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Use custom details view", exact: true })
        .isChecked(),
      false,
    );
    await page.getByRole("button", { name: /Saved a draft/ }).click();
    await frame.locator(".network-json-tree").waitFor();
    assert.equal(await frame.locator(".demo-detail-card").count(), 0);
    await page
      .getByRole("checkbox", {
        name: "Use the dark Midnight theme",
        exact: true,
      })
      .uncheck();
    assert.equal(
      await frame
        .locator("body")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(255, 255, 255)",
    );
  }));

test("demo checkbox changes publish one labeled event with state from page and shadow controls", () =>
  fixture(async (page) => {
    const cases = [
      ["Use the dark Midnight theme", "page"],
      ["Use custom details view", "page"],
      ["Size sorting", "page"],
      ["Previous page loads", "inspector"],
      ["Follow waterfall", "inspector"],
    ];
    for (const [label, source] of cases) {
      const before = await page.evaluate(
        () =>
          window.inspector.store.entries.filter(
            (e) => e.eventType === "demo.checkbox.changed",
          ).length,
      );
      const input = page.getByLabel(label, { exact: true });
      const checked = await input.isChecked();
      await input.setChecked(!checked);
      const events = await page.evaluate(() =>
        window.inspector.store.entries
          .filter((e) => e.eventType === "demo.checkbox.changed")
          .map((e) => ({
            label: e.label,
            data: JSON.parse(new TextDecoder().decode(e.body.bytes)),
          })),
      );
      assert.equal(events.length, before + 1);
      assert.equal(events.at(-1).data.checked, !checked);
      assert.equal(events.at(-1).data.source, source);
      assert.equal(events.at(-1).data.label, label);
    }
    await page
      .getByRole("group", { name: "Visible columns", exact: true })
      .getByLabel("HTTP code", { exact: true })
      .uncheck();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            new TextDecoder().decode(
              window.inspector.store.entries
                .filter((e) => e.eventType === "demo.checkbox.changed")
                .at(-1).body.bytes,
            ),
          ).control,
      ),
      "code",
    );
  }));

test("demo spans grow on a held timeline and finish in the same retained row", () =>
  fixture(async (page) => {
    await page.evaluate(() => {
      window.spanTime = 1000;
      window.inspector.store.now = () => window.spanTime;
    });
    await page
      .getByRole("button", { name: "Start event span", exact: true })
      .click();
    const row = page.getByRole("button", { name: /Build report span/ });
    await row.waitFor();
    const bar = row.locator(".network-track i");
    await page.evaluate(() => (window.spanTime = 1500));
    await page.waitForFunction(
      () =>
        parseFloat(
          window.inspector.root
            .querySelector('[data-event-span="true"] .network-track i')
            .style.width.match(/[\d.]+%/)?.[0] || "0",
        ) > 5,
    );
    const first = await bar.getAttribute("style");
    await row.click();
    await page.evaluate(() => (window.spanTime = 2500));
    await page.waitForFunction(
      (first) =>
        window.inspector.root
          .querySelector('[data-event-span="true"] .network-track i')
          .getAttribute("style") !== first,
      first,
    );
    const id = await row.getAttribute("data-entry-id");
    await page
      .getByRole("button", { name: "Finish event span", exact: true })
      .click();
    await page.waitForFunction(
      (id) => window.inspector.store.byId.get(Number(id)).status === "Complete",
      id,
    );
    assert.equal(await row.getAttribute("data-entry-id"), id);
    assert.equal(await row.count(), 1);
    await row.getByText("Complete", { exact: true }).waitFor();
    assert.match(await row.textContent(), /Complete/);
    const details = page.frameLocator(".network-detail-frame");
    await details.getByText("Report ready", { exact: false }).first().waitFor();
    assert.match(await details.locator("body").textContent(), /1500\.0 ms/);
    const finished = await bar.getAttribute("style");
    await page.evaluate(() => (window.spanTime = 4000));
    await page.waitForTimeout(350);
    assert.equal(await bar.getAttribute("style"), finished);
    await page.evaluate(() =>
      window.inspector.recordEvent({ label: "Still records" }),
    );
    assert.equal(
      await page.evaluate(() => window.inspector.store.entries.at(-1).label),
      "Still records",
    );
  }));

test("timed demo spans complete automatically and pause prevents a new span", () =>
  fixture(async (page) => {
    await page
      .getByRole("button", { name: "Run a 3-second span", exact: true })
      .click();
    await page.getByRole("button", { name: /Build report span/ }).waitFor();
    await page.waitForFunction(() =>
      document.getElementById("span-result").textContent.startsWith("Complete"),
    );
    const result = await page.evaluate(() =>
      window.inspector.store.entries.find((e) => e.eventSpan),
    );
    assert.equal(result.status, "Complete");
    assert.ok(result.end - result.start >= 2900);
    await page
      .getByRole("button", { name: "Pause recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start event span", exact: true })
      .click();
    assert.match(
      await page.locator("#span-result").textContent(),
      /Recording paused/,
    );
    assert.equal(
      await page.evaluate(
        () => window.inspector.store.entries.filter((e) => e.eventSpan).length,
      ),
      1,
    );
  }));
