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
a colorful Activity Insight column and wraps the code renderer. Its badges show
recorded latency, message direction and size, event types, and correlation IDs.
Use the visibility checkboxes to hide or restore any column, including defaults.
At least one remains visible. Reset columns restores the complete default layout.
The Size sorting and Insight sorting switches demonstrate enabling and disabling
comparators without removing their columns.

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

## Sorting a column

Set `sort` to a synchronous comparator `(leftEntry, rightEntry) => number`.
Use the same convention as `Array.sort`: negative puts the left entry first
in ascending order, positive puts it after, and zero preserves chronological
order for ties. Return a finite number. The inspector copies the entries
before sorting, so capture order does not change.

Click a sortable header to cycle **descending → ascending → chronological**.
Only one column controls ordering at a time. Sorting holds the visible page
while capture continues. Follow waterfall and Jump to latest restore time order.
Replacing columns resets sorting. Non-sortable headers have no sort button.
A comparator failure produces a visible “Sort failed” message and falls back
to chronological order; capture continues.

`sizeSorter` is the exported comparator used by the default Size definition.
It compares message bytes, response body bytes, or resource transfer bytes and
keeps unavailable sizes last in both directions. The legacy `sort: "size"`
shorthand is also accepted. Defaults other than Size have sorting disabled.

```js
import { defaultColumns, sizeSorter } from "web-network-inspector";
const duration = (entry) => (entry.end == null ? 0 : entry.end - entry.start);

inspector.setColumns([
  ...defaultColumns.map((column) =>
    column.id === "size"
      ? { ...column, sort: false } // Hide the Size sort button.
      : column,
  ),
  {
    id: "latency",
    label: "Latency",
    width: 160,
    render: (entry) => duration(entry).toFixed(0) + " ms",
    sort: (left, right) => duration(left) - duration(right),
  },
]);

// A different column can reuse the default Size comparator.
const bytesColumn = {
  id: "bytes",
  label: "Bytes",
  width: 100,
  render: (entry) => entry.responseBody?.size ?? "—",
  sort: sizeSorter,
};
```

The [demo column source](https://github.com/inferal-oss/web-network-inspector/blob/main/examples/insight-column.js)
contains a complete DOM renderer, scoped styles, and a comparator. The renderer
creates a colored badge and a second line from the retained entry, using
`document.createElement` and `textContent`. Its comparator sorts completed
entries by recorded duration; unfinished entries and point events use zero.
It labels unavailable sizes and active connections instead of inventing
measurements. Request latency badges use green below 500 ms, amber from 500 ms
to 1,999 ms, and red at 2,000 ms or above. These thresholds belong to this demo
renderer and can be changed in its source.

## Definition fields

| Field       | Default  | Meaning                                                  |
| ----------- | -------- | -------------------------------------------------------- |
| `id`        | required | Unique, nonempty string                                  |
| `label`     | required | Header and accessible resize label                       |
| `render`    | required | Synchronous function described above                     |
| `width`     | 160      | Initial width in pixels                                  |
| `minWidth`  | 40       | Resize minimum, at least 24                              |
| `maxWidth`  | 2400     | Resize maximum, at most 4000                             |
| `flex`      | false    | Grow to use spare space; manual resizing fixes its width |
| `live`      | false    | Refresh even when the entry has not changed              |
| `className` | empty    | Cell classes inside the inspector's shadow root          |
| `sort`      | unset    | Comparator function enables sorting; false disables it   |

Provide 1–24 columns and finite widths within their bounds. Invalid arrays are
rejected before replacing the current layout or installing capture. Widths are
kept for this inspector instance. Save `getColumns()` widths in your application
if desired; functions themselves cannot be serialized to JSON.

The optional React component accepts `columns` too. Keep the array stable with
`useMemo`; a changed identity recreates the inspector.
