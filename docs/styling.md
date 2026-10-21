# Styling guide

Match the inspector to your application with CSS variables, add targeted overrides, or supply an entirely different stylesheet.

## How the styles are isolated

Each inspector lives in an open Shadow DOM root. Your page's ordinary button, input, and layout rules do not reach its internal elements. The inspector also leaves your page's global styles and padding alone.

The returned `host` is a normal element marked with `data-web-network-inspector`. The returned `root` is its shadow root. Custom bar elements and popup content move inside that root, too.

## Start with CSS variables

Put a rule like this in your application's stylesheet:

```css
[data-web-network-inspector] {
  --panel: #ffffff;
  --paper: #faf7ff;
  --ink: #272036;
  --muted: #706580;
  --line: #e2d9ee;
  --brand: #7c3aed;
  --brand-dark: #6d28d9;
  --brand-soft: #ede9fe;
  --signal: #b63460;

  --sans: system-ui, sans-serif;
  --mono: ui-monospace, monospace;
  --text-10: 11px;
  --text-11: 12px;
  --network-height: 55vh;
}
```

A host rule can override the defaults declared inside the shadow root. Scope the selector to a class on one host if your page has multiple inspectors:

```js
inspector.host.classList.add("preview-inspector");
```

```css
.preview-inspector {
  --brand: #087f6f;
  --brand-dark: #065e52;
  --brand-soft: #e5f6f1;
}
```

## Theme tokens

| Token                           | Controls                                      |
| ------------------------------- | --------------------------------------------- |
| `--panel`                       | Main panel, controls, and popup surfaces      |
| `--paper`                       | Bar, header, and secondary backgrounds        |
| `--ink`                         | Primary text                                  |
| `--muted`                       | Secondary text and metadata                   |
| `--line`                        | Borders and grid lines                        |
| `--brand`                       | Main accent, waterfall bars, and focus rings  |
| `--brand-dark`                  | Links and emphasized controls                 |
| `--brand-soft`                  | Selected-row background                       |
| `--signal`                      | Application-event accents                     |
| `--sans`, `--mono`              | Interface and data font families              |
| `--text-10` through `--text-14` | Most interface and data font sizes            |
| `--text-21`, `--text-22`        | Larger close-control sizes                    |
| `--weight-regular`              | Regular text weight in selected components    |
| `--network-height`              | Initial desktop panel height, normally `48vh` |

Some accents, including JSON token colors and socket/message colors, currently use fixed values. Override their selectors inside the shadow root when creating a complete theme. Mobile rules and user resizing can override the initial height.

## Add an override stylesheet

Append a stylesheet link after the inspector's default link. Its CSS can target internal selectors:

```js
const overrides = document.createElement("link");
overrides.rel = "stylesheet";
overrides.href = "/assets/inspector-overrides.css";
inspector.root.append(overrides);
```

```css
/* inspector-overrides.css, loaded inside the shadow root */
.network-bar {
  height: 46px;
  gap: 12px;
}

.network-row {
  min-height: 40px;
}

.network-popup {
  border-radius: 16px;
}

.network-json-string {
  color: #087f6f;
}
```

For a dark theme, set suitable host variables and also override `:host { color-scheme: dark; }` in this stylesheet. Check fixed token colors and selected/disabled states for contrast. Preserve the focus outlines and the `[hidden]` behavior.

The details iframe loads the inspector's `stylesheet` URL too, and copies the
host's CSS variables when its document becomes ready. Put persistent details
overrides in that stylesheet, using `.network-detail-content` for the frame's
body. A style element added only to the shadow root does not cross the iframe
boundary. Custom [details renderers](details.md) can add styles to their supplied
document. Theme-variable changes after the frame loads require remounting the
inspector or applying the same variables in the renderer's document.

## Replace the base stylesheet

```js
const inspector = createInspector({
  stylesheet: "/assets/my-inspector.css",
});
```

This replaces the built-in stylesheet. To retain the layout, import a public copy of the base stylesheet at the top of your custom CSS, followed by your overrides:

```css
@import url("./network-inspector-base.css");

.network-bar {
  height: 46px;
}
.network-popup {
  border-radius: 16px;
}
```

Serve `web-network-inspector/style.css` as `network-inspector-base.css` in this example. Browsers do not resolve npm package names inside CSS imports on their own. The optional `nonce` setting applies to the default stylesheet link; your application's CSP must also permit any added stylesheet.

## Style custom elements

Use classes on your bar elements and popup content, then define those classes in your shadow-root override stylesheet:

```js
const status = document.createElement("span");
status.className = "application-status";
status.textContent = "Ready";
inspector.addBarItem({ id: "status", element: status });
```

```css
.application-status {
  padding: 4px 10px;
  border-radius: 999px;
  color: #065e52;
  background: #e5f6f1;
  font:
    12px system-ui,
    sans-serif;
}
```

Inline styles also work. Supply accessible names and keyboard behavior for application-owned controls.

## Layout and selector stability

The panel is fixed to the bottom of the viewport and overlays the page. Reserve space in your application layout if needed. Avoid hiding its close control or making its scroll areas inaccessible.

CSS variables are the simplest customization surface. Internal class and ID selectors reflect the current markup; review overrides when upgrading the library. The source stylesheet is available in the repository and through the exported `web-network-inspector/style.css` path.

## Try a theme in the demo

Use **Use the custom Plum theme** in the [live demo](https://oss.inferal.org/web-network-inspector/demo/).
It changes the host's surface and accent variables, adds a gradient bar and
rounded controls inside the shadow root, and copies current variables into the
open details iframe. Switch back to compare with the defaults. The demo
remembers this application-owned switch separately from inspector view settings.

The theme uses `:host([data-demo-effective="plum"])` rules added through
`inspector.root.append(style)`. The accompanying card shows copyable CSS. Open
Regard's clarity and contrast profiles use inline host variables, which take
precedence over these stylesheet rules. See [the demo source](https://github.com/inferal-oss/web-network-inspector/blob/main/examples/demo.js)
for the switch and live iframe synchronization. This theme is a demonstration,
not an additional built-in inspector option.

## Complete dark styling in the demo

Choose **Use the dark Midnight theme** in the demo. It covers panel surfaces,
controls, popups, custom Activity Insight badges, error codes, the application
summary, headers, JSON trees, hex previews, and syntax-highlighted source. Plum
and Midnight are mutually exclusive; turning both off restores default styling.
The choice is saved in the application's localStorage. Open Regard's Clarity
and Contrast profiles temporarily use a light palette; Standard and Vision
restore the chosen theme.

The [theme module](https://github.com/inferal-oss/web-network-inspector/blob/main/examples/themes.js)
contains complete palettes and shared CSS. Changing only `--panel` and `--ink`
leaves fixed token colors unchanged, so a complete theme needs variables and
targeted rules:

```css
/* Install in the shadow root. */
:host([data-demo-effective="dark"]) {
  color-scheme: dark;
  --panel: #141c2b;
  --paper: #1c273b;
  --ink: #e7edf8;
  --muted: #b4c2d8;
  --line: #41516b;
  --brand: #a8bdff;
  --brand-dark: #c5d2ff;
  --brand-soft: #293856;
}
:host([data-demo-effective="dark"]) .network-json-string {
  color: #9be5c5;
}
:host([data-demo-effective="dark"]) .hljs-keyword {
  color: #d5b9ff;
}
```

Shadow-root styles do not enter the details iframe. Install matching rules
there using `:root[data-demo-effective="dark"]`, copy host custom properties,
and set that document's `color-scheme`. The demo's `syncDetailsDisplay(document)`
does this before rendering and on theme changes. It removes old copied
properties so palettes switch cleanly, then redraws the current selection with
`setDetailsRenderer`. These are application examples, rather than new built-in
theme options.

Custom column badges use application-owned properties such as `--demo-pink`
and `--demo-pink-wash`. Their light fallbacks live in the
[column source](https://github.com/inferal-oss/web-network-inspector/blob/main/examples/insight-column.js);
Midnight supplies light text and dark backgrounds. Theme changes update their
CSS without recreating the columns.

The default HTML preview gives unstyled content the surrounding text colors,
canvas, and color scheme when rendered. Authored HTML styles and image/video
pixels keep their original appearance. HTML stays in its opaque sandbox with
scripts and external loads disabled.

Use **Use custom details view** to compare the custom summary with the default
renderer; this switch is also remembered. Native checkbox changes on the page
and inside the inspector publish `demo.checkbox.changed` events with `control`,
`label`, `checked`, `source`, and `environment` fields. Programmatic restoration
does not publish these events. Capture filters and recording pause still apply.
