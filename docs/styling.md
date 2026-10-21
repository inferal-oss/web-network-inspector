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
