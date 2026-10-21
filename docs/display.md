# Display preferences with Open Regard

The [Inferal Open Source homepage](https://oss.inferal.org/) and this project's
landing page, documentation, and demo use [Open Regard](https://openregard.org/).
Choose **Display preferences** to select Standard, Vision, Clarity, or Contrast.
They change text size, spacing, and contrast. The inspector bar and details
iframe follow the same selection.

These pages share the same stable profile IDs and local-storage key,
`inferal-oss-display-v1`. Open Regard applies the saved choice before the page
paints and synchronizes changes between controls and open same-origin tabs.
Preferences on another domain, including openregard.org itself, are independent.
The controls use self-hosted Open Regard 0.3.0, with no third-party script request.

## Inspector integration

Open Regard is a website integration, not a dependency of the inspector package.
The demo mounts its native widget as an ordinary custom bar element. Profile
changes also produce `display.changed` application events with the previous and
new profile IDs. Select those rows to inspect their JSON data.

Use the same extension APIs in your application:

```js
import { createDisplay, mountDisplayWidget } from "openregard/display";

const display = createDisplay(yourDisplayConfig);
const container = document.createElement("div");
const item = inspector.addBarItem({ id: "display", element: container });
const widget = mountDisplayWidget(container, display);
const off = display.subscribe(() => {
  inspector.recordEvent({
    type: "display.changed",
    label: `Display · ${display.getSnapshot()}`,
    data: JSON.stringify({ profile: display.getSnapshot() }),
    parentId: null,
  });
});
// When the integration is removed:
// off(); widget.destroy(); item.remove();
```

Serve the widget's exported CSS and add a stylesheet link inside
`inspector.root`; a page-level stylesheet does not cross the shadow boundary.
Consume your profile's tokens in the application's CSS too. The demo uses rem
font sizes on the site and updates the inspector's font and color variables.
Its [details renderer](details.md) applies those variables to the iframe document
at render time and updates them when the preference changes.

The optional React integration can use the same `addBarItem` API through its ref
or `onReady` callback. Return cleanup from `onReady` for the widget and its
subscription. See Open Regard's documentation for its own React binding and
configuration options.
