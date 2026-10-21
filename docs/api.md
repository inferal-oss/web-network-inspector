# Public API

The [React component](react.md) wraps this API with React mounting and cleanup.

## `createInspector(options)`

Import from `web-network-inspector` or the source's `src/index.js`.

| Option          | Default                         | Meaning                                                                                    |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `scope`         | `window`                        | Browser window whose transports are captured.                                              |
| `container`     | `scope.document.body`           | DOM container for the host element.                                                        |
| `filter`        | unset                           | Synchronous predicate for an instance-owned store. See [capture filters](filtering.md).    |
| `store`         | `new NetworkCapture()`          | Retained history shared with this view.                                                    |
| `capture`       | `true`                          | Install transport wrappers. Set false for manual events or another view of a shared store. |
| `open`          | `false`                         | Start with the waterfall expanded.                                                         |
| `stylesheet`    | Module-relative `style.css` URL | CSS URL loaded inside the shadow root. Override for bundled assets.                        |
| `renderDetails` | Built-in content-type renderer  | Function receiving a sandboxed iframe and DOM context. See [request details](details.md).  |
| `nonce`         | unset                           | Optional nonce on the stylesheet link for the host's CSP policy.                           |

Returns `host`, `root` (the shadow root), `store`, and the methods below.
The host owns its styles and does not change the page's padding or global CSS.
One capture owner is allowed per scope; a second installation throws instead
of wrapping transports twice. Additional views use the same store with
`capture: false`. The capture owner must outlive those views if they need live
network traffic.

### `recordEvent({ type, label, data, correlationId, parentId })`

Record an application event with any string `type`. There are no predefined
application event names. `type` defaults to `event`, `label` to `type`, and
`correlationId` to null. `data` is an optional string, ArrayBuffer, or typed
array preview; serialize JSON explicitly. Other objects produce a visible
“preview unavailable” note. Labels are plain text.

Returns the retained entry, or null while paused. Event fields are `kind:
'event'`, `eventType`, `label`, `correlationId`, and `eventId` (the supplied
parent ID). `parentId` defaults to the most recent event recorded in the same
JavaScript task; pass null to start an independent event. `nearEvent` marks
chronological proximity, not a confirmed causal relationship. Use explicit IDs
when associating asynchronous work. Types, labels, and correlation strings
are bounded to 80, 160, and 128 characters respectively. The payload follows
the store's preview and memory limits.

### `subscribe(listener)`

Call a listener with no arguments when the store changes. Read `store.entries`
inside the callback. Returns an unsubscribe function. Callback failures do not
interrupt recording. Callbacks may run multiple times per entry as timings or
previews arrive. Do not mutate history in a callback.

### `annotateMessage(socket, direction, metadata)`

Attach caller-supplied metadata to the latest recorded WebSocket frame in
`direction` (`in` or `out`). Accepts `{ type, label, correlationId, eventId }`;
no protocol parsing or domain-specific correlation is performed. Returns the
updated entry or null if it is unavailable. A view with `capture: false` must
use the capture owner's method instead.

Call immediately after `socket.send()` or synchronously in the socket's message
listener, before handling another frame in that direction. It annotates that
frame even if the body preview is truncated or binary. Pass IDs explicitly:

```js
const action = inspector.recordEvent({
  type: "chat.send",
  label: "Send greeting",
});
socket.send(JSON.stringify({ text: "Hello" }));
inspector.annotateMessage(socket, "out", {
  type: "chat.message",
  correlationId: "example-room",
  eventId: action?.id,
});
```

### `addBarItem({ id, label, title, element, onClick })`

Add a control or arbitrary DOM element to the collapsed and expanded bar. `id`
must be a nonempty string unique in this inspector. The default element is a
button using `label` as text. Pass `element` for a select, status indicator,
input, or other custom node; the inspector moves that node into the bar.

`onClick({ event, inspector, element })` handles clicks. Returns:

- `element`: the stable DOM node.
- `update({ label, title, disabled })`: update supplied properties in place.
  Updating `label` replaces the element's contents with text.
- `remove()`: detach the node and click handler; close a popup anchored to it.
  Removal is idempotent and releases the ID for reuse.

Custom controls own their accessibility labels and listeners. Dispose any
application-owned external resources when removing the item.

### `openPopup({ title, content, anchor, onClose })`

Open one nonmodal popup per inspector, replacing any previous popup. The default
title is `Details`. `content` is plain text, a DOM node, or a synchronous renderer
`({ container, close }) => cleanup`. The renderer can return a cleanup function
for subscriptions, timers, or external resources. Strings are never interpreted
as HTML. A DOM node is moved into the popup. All content is application-owned.

Returns `element`, `update({ title, content })`, and `close()`. Content replacement
runs the previous cleanup function. Closing, replacement, anchor removal, and
inspector destruction run the current cleanup once and call `onClose()` once.
Escape and the close button close the popup; focus returns to `anchor` or the
previously focused element if connected. `anchor` receives `aria-haspopup` and
`aria-expanded`. The popup has a labelled `dialog` role, is nonmodal, and does
not trap focus. Applications must provide appropriate keyboard behavior for
custom content. For asynchronous content, start a request in the renderer,
update DOM on completion, and return cleanup that cancels or ignores stale work.

### `loadResource(entry)`

Load a separate, bounded resource preview with visible response headers and MIME type. It requires a retained browser resource entry and the capture owner. See [request details](details.md) for the distinction from the original load.

### `setOpen(boolean)` and `destroy()`

Expand or collapse the waterfall. `destroy()` removes the UI, listeners, render
timers and owned transport wrappers, and closes popup resources. It does not
close application sockets or abort application requests. It is idempotent.
Other inspector methods throw after destruction. Store history remains readable;
call `store.clear()` if it should also be discarded. Unsubscribe application
subscriptions explicitly. Wrappers installed by other code after this inspector
are left in place; teardown cannot remove this wrapper from inside theirs.

## Headless capture and retained history

```js
import {
  NetworkCapture,
  installNetworkCapture,
} from "web-network-inspector/capture";

const store = new NetworkCapture({ limits: { entries: 500, preview: 8192 } });
const capture = installNetworkCapture(window, store);
const off = store.subscribe(() => console.log(store.entries.length));
// capture.annotateMessage(socket, 'in', { type: 'custom.message' });
// off(); capture.disconnect(); store.clear();
```

`NetworkCapture({ now, limits, filter })` accepts a monotonic millisecond clock (`now`)
and initial limits. For browser resource timings use the scope's performance
time origin. Its optional `filter` chooses which network entries are retained;
see [capture filters](filtering.md). `installNetworkCapture(scope, store?)` returns `store`,
`annotateMessage`, and idempotent `disconnect()`.

| Limit                           | Default  | Maximum    |
| ------------------------------- | -------- | ---------- |
| `entries`                       | 5000     | 100000     |
| `messages` per socket           | 2000     | 100000     |
| `preview` bytes per body        | 262144   | 1048576    |
| `bytes` retained preview bytes  | 33554432 | 1073741824 |
| `readers` concurrent body reads | 8        | 64         |

All limits are positive integers. `store.setLimits({ entries, messages, preview,
bytes })` validates atomically and immediately trims history, even while paused.
Readers are configured only at construction. `captureLimits` and
`retentionBounds` expose frozen defaults and live-update upper bounds.

`store.entries` is oldest first. `store.byId` provides retained IDs. Entry kinds
are `http`, `socket`, `message`, `resource`, and `event`. Common fields include
`id`, `kind`, `start`, optional `end`, `status`, `url`, `nearEvent`, and `eventId`.
Transport fields include `transport`, `method`, `requestHeaders`,
`responseHeaders`, `requestBody`, `responseBody`, `body`, `direction`, and
`connection`. Resource preview fields include `resourceBody`, `resourceResponseHeaders`, and `resourceRequestHeaders`; their separate GET is identified by `resourceFetchedAt`, `resourceStatus`, and `resourcePreviewStatus`. Annotation fields include `protocol`, `label`, and `correlationId`.
Fields can arrive later and entries may be evicted. Treat entries as read-only.

`store.paused = true` skips new entries and body previews. Existing request
status and timing metadata may still complete. `store.clear()` discards
history and previews without changing limits or transport connections. Delayed
callbacks cannot restore evicted entries. Retention counters are available as
`bytes`, `expired`, and `expiredPreviews`. A frozen UI view holds IDs and row
labels, and may still show expired rows, but releases their payloads.

`bodyPreview(value, limit?, contentType?)` builds a bounded text or binary
preview. `previewText(preview)` returns text or a hex dump. A preview contains
`bytes`, `size` (possibly null), `text`, `truncated`, and optional `note` or
`expired`. Expired bodies keep no byte data.

## Persistent history and details rendering

See [local history](storage.md) for `createPersistentCapture`, IndexedDB storage, retention, and the storage lifecycle. See [request details](details.md) for content-type previews, sandboxed custom rendering, and resource loading. WebSocket closes add a point event with `kind: "socket"`, `socketEvent: "close"`, a connection ID, close code, reason, and clean-close flag, as well as finishing the connection lifetime row.
