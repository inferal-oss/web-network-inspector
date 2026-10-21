# Waterfall columns

Drag a divider in the column header to resize it. Focus a divider and press the
left/right arrows for 10-pixel steps, Shift plus an arrow for 50-pixel steps,
or Home/End for its minimum/maximum width. Wide tables scroll horizontally,
including on mobile, so request paths do not have to fit the screen.

## Default renderers

The package exports `hostPath`, `status`, `code`, `size`, and `waterfall`, plus
`columnRenderers` (the same functions in an object) and `defaultColumns` (an
immutable array of their definitions).

| Function    | Content                                                     |
| ----------- | ----------------------------------------------------------- |
| `hostPath`  | Entry ID, method/path or event label, and host with port    |
| `status`    | Request state, completion/error label, or event state       |
| `code`      | Numeric HTTP response code, or an em dash if unavailable    |
| `size`      | Message size, response body size, or resource transfer size |
| `waterfall` | Timing bar or point on the current timeline                 |

Browser resources show a code only when Resource Timing exposes `responseStatus`.
A separate resource preview's code belongs to that preview, not the original load.
WebSocket close codes are not HTTP codes.

## Add, replace, reorder, or remove columns

Supply the full ordered array to `createInspector({ columns })` or
`inspector.setColumns(columns)`. Reuse any default function with your own label,
width, and position. `inspector.getColumns()` returns copies of the current
settings, including resized widths. `setColumns(defaultColumns)` resets them.

```js
import {
  createInspector,
  defaultColumns,
  hostPath,
  code,
  waterfall,
} from "web-network-inspector";

const inspector = createInspector({
  open: true,
  columns: [
    { id: "request", label: "Request", width: 420, render: hostPath },
    { id: "code", label: "HTTP", width: 70, render: code },
    {
      id: "correlation",
      label: "Correlation",
      width: 160,
      render: (entry) => entry.correlationId ?? "—",
    },
    {
      id: "timing",
      label: "Timing",
      width: 180,
      flex: true,
      live: true,
      className: "network-track",
      render: waterfall,
    },
  ],
});

// Replace only the default HTTP code renderer; keep every other default.
inspector.setColumns(
  defaultColumns.map((column) =>
    column.id === "code"
      ? {
          ...column,
          render: (entry) =>
            typeof entry.status === "number" ? `HTTP ${entry.status}` : "—",
        }
      : column,
  ),
);
```

Try **Try custom columns** in the [live demo](https://oss.inferal.org/web-network-inspector/demo/). It adds
a Transport column, wraps the code renderer, and restores the defaults on demand.

## Renderer contract

Each synchronous `render(entry, context)` receives the retained entry and:

- `container`: this cell's DOM element.
- `document`: the cell's owning document, for creating DOM nodes.
- `timeline`: `{ start, end, now }`, in milliseconds since the page loaded.
- `store`: the retained capture store; treat it and entries as read-only.

Return a string, number, DOM node, or cleanup function. Alternatively, populate
`container` directly and return nothing. Strings are inserted as text. Async
renderers are not supported. Errors appear as “Renderer error” in that cell.

```js
const correlation = {
  id: "correlation",
  label: "Correlation",
  width: 160,
  render(entry, { container, document }) {
    const button = document.createElement("button");
    button.textContent = entry.correlationId ?? "Unlinked";
    button.addEventListener("click", () => console.log(entry.correlationId));
    container.append(button);
    return () => button.remove();
  },
};
```

Interactive controls handle their own clicks without selecting the row. Use
accessible labels and keyboard-operable native controls. Custom content is
cleared before another render. Cleanup runs before replacement, when a row is
removed or its retained entry expires, and when the inspector is destroyed.
Frozen browsing rows release custom content if its entry is evicted.

A renderer runs when its entry changes. Set `live: true` to run on each timeline
refresh, as the built-in waterfall does. Rendering is suspended while browsing
fixed rows. Avoid side effects and expensive work in live renderers.

## Definition fields

| Field       | Default  | Meaning                                                      |
| ----------- | -------- | ------------------------------------------------------------ |
| `id`        | required | Unique, nonempty string                                      |
| `label`     | required | Header and accessible resize label                           |
| `render`    | required | Synchronous function described above                         |
| `width`     | 160      | Initial width in pixels                                      |
| `minWidth`  | 40       | Resize minimum, at least 24                                  |
| `maxWidth`  | 2400     | Resize maximum, at most 4000                                 |
| `flex`      | false    | Grow to use spare space; manual resizing fixes its width     |
| `live`      | false    | Refresh even when the entry has not changed                  |
| `className` | empty    | Cell classes inside the inspector's shadow root              |
| `sort`      | unset    | `"size"` enables the built-in size sort button in the header |

Provide 1–24 columns and finite widths within their bounds. Invalid arrays are
rejected before replacing the current layout or installing capture. Widths are
kept for this inspector instance. Save `getColumns()` widths in your application
if desired; functions themselves cannot be serialized to JSON.

The optional React component accepts `columns` too. Keep the array stable with
`useMemo`; a changed identity recreates the inspector.
