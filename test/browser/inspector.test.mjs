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
    await page.getByRole("button", { name: /GET \/echo/ }).waitFor();
    await page.getByRole("button", { name: /GET \/echo/ }).click();
    await page
      .locator("#network-detail")
      .getByText('"message":', { exact: true })
      .waitFor();
    assert.match(
      await page.locator("#network-detail").textContent(),
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
    await page.waitForFunction(() =>
      window.inspector.root
        .getElementById("network-latest")
        .textContent.includes("230 new"),
    );
    assert.equal(await page.locator(".network-row").count(), before);
    assert.match(
      await page.locator("#network-detail").textContent(),
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
    const resizer = page.getByRole("separator");
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
      await page.locator("#network-detail").textContent(),
      /demo.note/,
    );
    assert.match(
      await page.locator("#network-detail").textContent(),
      /"environment": "Preview"/,
    );
    assert.match(
      await page.locator("#network-detail").textContent(),
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
