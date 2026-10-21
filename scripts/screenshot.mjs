import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createExampleServer } from "./serve.mjs";

// Exercise the same controls a person uses, then capture the resulting demo.
export async function captureScreenshots({
  output = fileURLToPath(new URL("../examples/screenshots", import.meta.url)),
} = {}) {
  output = resolve(output);
  await mkdir(output, { recursive: true });
  const server = createExampleServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 1,
    });
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
    await page.routeWebSocket("wss://ws.postman-echo.com/raw", (socket) =>
      socket.onMessage((message) => socket.send(message)),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.inspector);
    // Warm the lazy asset before the demonstration so it does not displace
    // the HTTP and WebSocket rows in this compact screenshot.
    await page.evaluate(async () => {
      await import("/src/vendor/highlight.js");
      window.inspector.host.style.setProperty("--network-height", "58vh");
    });
    await page.waitForTimeout(50);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page
      .getByRole("button", { name: "Fetch example JSON", exact: true })
      .click();
    await page.getByRole("button", { name: /POST \/anything/ }).waitFor();
    await page.getByLabel("Demo environment").selectOption("Preview");
    await page.getByLabel("Level", { exact: true }).selectOption("success");
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page
      .getByLabel("Event label", { exact: true })
      .fill("Published a preview");
    await page
      .getByRole("button", { name: "Record an application event", exact: true })
      .click();
    await page.getByRole("button", { name: "Connection · ready" }).click();
    await page
      .getByRole("button", { name: "Record a check", exact: true })
      .click();
    await page.getByRole("button", { name: /Published a preview/ }).click();
    await page
      .frameLocator(".network-detail-frame")
      .locator(".network-json-tree")
      .waitFor();
    await page
      .getByRole("button", { name: "Connect WebSocket", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.waitForFunction(() =>
      window.inspector.store.entries.some(
        (entry) => entry.label === "Echoed WebSocket message",
      ),
    );
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await page
      .getByRole("button", { name: /Echoed WebSocket message/ })
      .click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await page
      .getByRole("button", { name: /WebSocket disconnected/ })
      .waitFor();
    await page
      .getByRole("button", { name: /Echoed WebSocket message/ })
      .click();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.inspector.root.getElementById("network-rows").scrollTop = 0;
    });
    await page.screenshot({ path: resolve(output, "demo.png") });
    await page.getByRole("button", { name: "Connection · ready" }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: resolve(output, "popup.png") });
    console.log(`Screenshots saved to ${output}`);
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await captureScreenshots({ output: process.argv[2] });
