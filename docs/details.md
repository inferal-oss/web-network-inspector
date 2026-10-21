# Request details and custom rendering

Every network row shows its host and port below the request or message label.
Select a row to inspect its metadata, request headers, response headers, and
retained bodies. The details panel uses a sandboxed iframe so application CSS
does not affect its content.

## Default content previews

The default renderer uses each body's `contentType`:

| Content type               | Preview                                            |
| -------------------------- | -------------------------------------------------- |
| JSON and `+json`           | Expandable properties and arrays, plus raw JSON    |
| HTML                       | Nested sandboxed iframe and source text            |
| Images, including SVG      | Image from retained bytes                          |
| Audio and video            | Native media controls for a complete retained body |
| Text, CSS, JavaScript, XML | Syntax-colored source text                         |
| Other binary data          | Hex dump                                           |

Messages without a MIME type use JSON when their retained text is valid JSON.
Truncated previews show how many bytes were retained. Incomplete images and
media fall back to their retained text or hex bytes. HTML previews disable
scripts, forms, navigation permissions, and external network loads. Images and
media use local blob URLs, which are released when the renderer is replaced.

## Syntax highlighting

Text previews use highlight.js 11.11.1 with its complete bundled language registry.
The browser loads the self-hosted highlighter on the first text preview. There
is no CDN request and no extra runtime npm dependency. The renderer chooses a
language from the MIME type or URL extension, including highlight.js aliases.
For unknown types, it attempts automatic detection only for snippets up to
2,048 characters. Larger unknown bodies remain plain text. Binary hex dumps,
expired previews, and unavailable bodies remain plain text. Raw JSON and HTML
source are highlighted too. All source remains selectable and is escaped by
the highlighter; HTML source never becomes executable markup.

Colors are in the inspector stylesheet as standard `.hljs-*` token classes.
A replacement stylesheet can override these colors in the details iframe.

## Browser resources

Fetch and XHR wrappers capture the headers visible to JavaScript and bounded
body previews while requests run. Install capture before issuing those requests.
Browser-managed headers such as Cookie are not exposed, and cross-origin
responses are limited by CORS.

The Resource Timing API exposes timing and sizes for stylesheet, script, image,
and similar browser loads. It does not expose their original headers or bytes.
The **Load resource preview** button makes a separate GET with `cache:
"force-cache"` and same-origin credentials. It prefers the browser cache but can
use the network. The details explicitly label its preview headers and body;
they can differ from the original response. Original timing remains unchanged.
Cross-origin previews require a readable CORS response. A failure is displayed
and can be retried. Previews use the same body limits and reader budget.

You can also call `await inspector.loadResource(entry)` for a retained
`kind: "resource"` entry. It does not replay the original request's headers or
method. It requires the capture owner and an HTTP(S) URL without credentials.
The library defaults to `resourcePreviews: "manual"`. Set `resourcePreviews: "on-select"` to load the first preview when a resource is selected. The public demo uses this mode and shows the response without a load button. Failed previews expose a retry button. Request and response header dumps are expanded by default. Original resource timing is available in a separate disclosure.

## Replace or extend the renderer

`createInspector({ renderDetails })` calls your synchronous function with:

- `entry`: the selected retained entry, or null for an empty/expired selection.
- `selected`: selected entry ID, or null.
- `iframe`: the details iframe, sandboxed with `allow-same-origin` and no scripts.
- `document`, `container`: that iframe's document and body. Create nodes with this document.
- `store`: the capture store, treated as read-only by renderers.
- `renderDefault()`: render the built-in metadata and content previews.
- `loadResource(entry)`: load a separate resource preview when this view owns capture; otherwise undefined.
- `select(id)`, `showMessages(connectionId)`: navigate the inspector.

Return a cleanup function for subscriptions, timers, or other resources.
Cleanup runs before replacement and on destruction. The callback runs when the
selection or its retained data changes; unrelated incoming traffic does not
recreate the selected view. Renderer errors produce an error message in the
panel. The frame's document is ready before your function runs.

```js
const inspector = createInspector({
  open: true,
  renderDetails({ entry, document, container, iframe, renderDefault }) {
    renderDefault();
    if (!entry) return;
    const note = document.createElement("p");
    note.textContent = `Application correlation: ${entry.correlationId ?? "none"}`;
    container.append(note);
    // iframe is available for application-owned rendering and sizing.
    return () => note.remove();
  },
});
```

Omit `renderDefault()` to replace all content. Strings are rendered as text;
use DOM APIs for custom content. Keep the sandbox restrictions in place. The
built-in renderer is also exported as `renderDefaultDetails(context)` for
wrappers that forward the complete context. If called directly, return or call
its cleanup function. `renderDefault()` manages that cleanup for you.

The React component accepts the same `renderDetails` prop. Keep the callback
stable with `useCallback`; changing its identity recreates the inspector.

Restored entries show **Previous page** for their start time and retain their absolute capture timestamp. The range label identifies history from previous page loads.

## Try the application's custom renderer

Select any row in the [live demo](https://oss.inferal.org/web-network-inspector/demo/).
Its **Custom application summary** appears above the default renderer. Events
show their level, environment, and correlation; requests show duration and
payload size; WebSocket frames show direction. The renderer calls
`context.renderDefault()` after appending its own card, preserving the standard
headers and body previews. See the [complete renderer source](https://github.com/inferal-oss/web-network-inspector/blob/main/examples/detail-renderer.js)
for DOM creation, scoped styles, and cleanup. The demo's Plum theme switch also
updates CSS variables in the already-open iframe.
