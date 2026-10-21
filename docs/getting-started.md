# Get started

Add a network waterfall to your application with a few lines of JavaScript. Web Network Inspector has no runtime dependencies and does not require a framework.

## Install from source

The package is named `web-network-inspector`. Until an npm release is published, install the current source directly from GitHub:

```sh
npm install github:inferal-oss/web-network-inspector
```

You can also clone the repository and serve the `src/` directory alongside your application. No library build step is required.

## Create an inspector

```js
import { createInspector } from "web-network-inspector";

const inspector = createInspector({ open: true });
```

Install the inspector before creating requests and WebSocket connections that you want to inspect. It wraps fetch, XMLHttpRequest, and new WebSocket connections in the selected browser window. Resource timings appear where the browser makes them available.

The inspector loads its own stylesheet relative to the module. If your bundler emits CSS separately, serve the exported `web-network-inspector/style.css` asset and pass its public URL:

```js
const inspector = createInspector({
  open: true,
  stylesheet: "/assets/network-inspector.css",
});
```

## Record application events

An event can represent anything meaningful in your application. Use your own types and labels; serialize structured payloads explicitly.

```js
const saved = inspector.recordEvent({
  type: "document.saved",
  label: "Saved a draft",
  correlationId: "example-document",
  parentId: null,
  data: JSON.stringify({ revision: 3, source: "save-button" }),
});
```

Events share the same timeline as requests and messages. Correlation IDs are application metadata. The inspector does not infer a backend protocol.

## Add a control and popup

```js
const connection = inspector.addBarItem({
  id: "connection",
  label: "Connection · ready",
  onClick: ({ element }) => {
    inspector.openPopup({
      title: "Connection details",
      anchor: element,
      content: "This content belongs to your application.",
    });
  },
});

connection.update({ label: "Connection · reconnecting" });
```

Pass a DOM element to `addBarItem` for a native select, status indicator, or another custom control. Popup content may also be a DOM element or a renderer with a cleanup function. See the [API reference](./api/) for the complete contracts.

## Inspect without losing your place

Select a row to inspect its headers or retained body. Browsing or selecting holds the visible rows and waterfall scale while recording continues. Jump to latest releases that view. Search, connection filters, size sorting, paging, and retention controls stay available in the panel.

## Set capture limits

```js
import { NetworkCapture, createInspector } from "web-network-inspector";

const store = new NetworkCapture({
  limits: { entries: 500, preview: 8192, bytes: 2 * 1024 * 1024 },
});
const inspector = createInspector({ store });

store.setLimits({ entries: 250 });
```

Limits trim retained history and preview bytes. They do not limit the browser's own network buffers or your application's copies of data. Request streams are never read by the recorder. Fetch previews read a bounded prefix from a response clone.

## Dispose when finished

```js
connection.remove();
inspector.destroy();
inspector.store.clear();
```

Destroy removes the inspector UI and its transport wrappers, but keeps retained history readable. Clear the store separately when you want to discard it. Destroy does not close your sockets or abort application requests.

## Data stays in the page

The inspector holds captured data in memory. It does not send telemetry, persist history, or contact a service. Captured URLs, headers, and bodies can contain sensitive application data, and there is no automatic redaction. Enable it only where capture is appropriate.
