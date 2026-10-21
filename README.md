# Web Network Inspector

An extensible, in-page network waterfall. Capture fetch, XMLHttpRequest,
WebSocket frames, resource timings, and your own application events in one view.
The library is plain JavaScript with no runtime dependencies or build step.

- Bounded local history and body previews, configurable while recording.
- Search, connection and type filters, size sorting, and paged history.
- Stable rows and time scale while selecting or browsing incoming traffic.
- Text, binary hex, and expandable JSON previews, including truncated JSON.
- Generic application events, custom bar items, and application-owned popups.
- Shadow DOM styles, keyboard controls, and explicit teardown.

## Try the example

Requires Node.js 22.5 or later for development.

```sh
npm ci
npm start
```

Open the local URL printed by the server. The example generates synthetic
application events and sends synthetic JSON to httpbin.org when you click the
request button. A bundled response keeps the demo usable if httpbin is unavailable.
`PORT` selects another port.

## Embed

Use a relative module URL when serving the source directly:

```js
import { createInspector } from "./src/index.js";

const inspector = createInspector({ open: true });
inspector.recordEvent({
  type: "cart.changed",
  label: "Added an item",
  correlationId: "example-cart",
  data: JSON.stringify({ count: 1 }),
});
```

Package consumers can import from `web-network-inspector` after installing a
local checkout or package archive. This repository does not require publication
to run. Serve `src/style.css` alongside the module. For a bundler that emits CSS
separately, pass its public CSS URL as `stylesheet`.

```js
const item = inspector.addBarItem({
  id: "connection",
  label: "Connection · ready",
  onClick: ({ element }) => {
    inspector.openPopup({
      title: "Connection details",
      anchor: element,
      content: "Your application supplies this content.",
    });
  },
});
item.update({ label: "Connection · busy" });
// item.remove();
// inspector.destroy();
```

See [the API reference](docs/api.md) for custom DOM controls, popup content
renderers and cleanup, headless capture, shared views, and message annotation.

## Scope and data handling

Install before creating requests or sockets that you want to inspect. Capture
is opt-in per browser scope and held in memory by default. Optional
[IndexedDB history](docs/storage.md) retains bounded objects across reloads.
The inspector does not send telemetry. [Resource previews](docs/details.md)
make a separate GET only when requested.
Recorded headers, URLs, and bodies can contain sensitive application data;
only enable capture where that is appropriate. There is no automatic redaction.

Fetch returns the original response. Its preview uses a bounded read from a
clone; the browser's own stream buffering is outside the retained-preview
budget. Request streams are never read. XHR and WebSocket callers keep their
native results and errors. Existing sockets, other frames, workers,
EventSource, and service-worker traffic are not automatically intercepted.
Resource timing may omit cross-origin details. Without resource timing, fetch
duration ends at response headers, rather than body completion.

Modern browsers with ES modules and Shadow DOM are required. JSON previews
preserve number spelling when the browser provides source tokens; otherwise
unsafe numbers fall back to raw text. The panel overlays the bottom of the
page; reserve space in your application layout if needed. Popup contents are
application-owned; a popup is a nonmodal dialog with Escape and focus return.

## Develop

```sh
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

Tests run independently of any backend. Browser tests start a loopback server
on a free port and close it afterward. The package export list includes only
library files, public documentation, and license notices.

Licensed under either [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT), at your
option (`MIT OR Apache-2.0`). See [provenance and third-party notices](NOTICE.md).

## Interactive demo

The example includes user-triggered HTTP requests, an event label and level,
and three custom bar elements: an environment select, a live event counter,
and a connection button with an application-owned popup. Application events are
recorded when you interact with a control.

After installing Chromium, run `npm run screenshot` to exercise the controls
and regenerate `examples/screenshots/demo.png` and `popup.png`. The screenshot
script closes its browser and local server when finished.

## Project website

`npm run build:site` builds the landing page, live demo, API reference, and
styling guide into `dist/`. The build captures fresh demo and popup screenshots
from the current source, so the landing image stays in sync on every Pages
deployment. Install Chromium first with `npx playwright install chromium`.
The API page is generated from `docs/api.md`.
`npm run test:site` checks links, static-hosting paths, docs, mobile layout,
and demo interactions under `/web-network-inspector/`.

GitHub Pages deploys the inspector repository's own artifact on successful
main-branch builds. The organization site supplies the shared domain.

## React and capture filters

An optional React 18+ component is available from `web-network-inspector/react`.
The core module never imports React, and React is an optional peer dependency.
See the [React guide](docs/react.md) for refs, lifecycle, and styling.

Pass a synchronous `filter` to `createInspector`, or configure it on a shared
`NetworkCapture`. Factories include `byHostnames`, `byOrigins`, `byMethods`,
`allOf`, `anyOf`, and `not`. See the [filtering guide](docs/filtering.md).

The demo also connects to Postman’s public WebSocket echo service after you
click Connect, then captures sent and echoed messages as separate frames.

[Remember layout and sorting](docs/preferences.md) · [Waterfall columns and custom renderers](docs/columns.md) · [Request details and custom iframe renderers](docs/details.md) · [Local history and retention](docs/storage.md)

The public site and demo use synchronized [Open Regard display preferences](docs/display.md). This integration adds no runtime dependency to the inspector package.
