# Local history and retention

Core capture stays in memory by default. Use `createPersistentCapture` to keep
bounded request objects, visible headers, MIME types, and body previews in
IndexedDB across reloads. The demo enables this with its own database name.
There is no server upload or telemetry.

```js
import {
  createInspector,
  createPersistentCapture,
  createIndexedDBStorage,
} from "web-network-inspector";

const store = await createPersistentCapture({
  storage: createIndexedDBStorage({ database: "my-app-network-debug" }),
  maxAge: 24 * 60 * 60 * 1000,
  limits: {
    entries: 5000,
    messages: 2000,
    preview: 256 * 1024,
    bytes: 32 * 1024 * 1024,
  },
  // filter: byHostnames(["api.example.com"]),
});
const inspector = createInspector({ store, open: true });
```

Await the factory before starting capture. It restores valid retained records,
reapplies the current filter and retention limits, and then subscribes to store
changes. Restored entries keep their wall-clock capture time and their relation
to other restored entries. Unfinished transports from the previous page are
marked interrupted. They do not represent active requests or sockets.

## Limits

The defaults are 5,000 entries, 2,000 messages per socket, 256 KiB per body, and
32 MiB of body previews. Use `store.setLimits({ entries, messages, preview,
bytes })` or the inspector's **Retention limits** controls to change them.
Limits apply to memory and the next stored snapshot. Lowering limits trims
existing data; raising them cannot recover discarded bytes. Resource previews
share these budgets with HTTP bodies and WebSocket frames.

`maxAge` is a positive integer in milliseconds; its default is 24 hours.
Expired entries are excluded whenever a snapshot is saved or restored. It is a
storage retention limit, not a timer that removes rows from a running view.
Only retained previews are saved; persistence cannot recover uncaptured headers,
expired previews, or the rest of a truncated response. Header metadata remains
bounded to 8 KiB per header section.

## Storage lifecycle

`store.persistence` exposes:

- `status`: `Ready` or `Unavailable` after initialization.
- `error`: the last storage error message, or null.
- `flush()`: await all pending changes being saved, including changes during a write.
- `clear()`: clear the store and await the empty snapshot being saved.
- `close()`: stop saving, flush pending changes, and close the storage connection.

Writes are coalesced over 250 ms. Call `flush()` before controlled navigation
when completion matters. Browser shutdown can interrupt an unfinished write.
Clear in the inspector also schedules an empty snapshot. Destroying a view does
not close a shared store; call `await store.persistence.close()` when its owner
is finished. Quota failures or unavailable IndexedDB leave capture usable in
memory and expose the error through `store.persistence`.

`createIndexedDBStorage({ indexedDB, database, key })` defaults to the browser's
IndexedDB, database `web-network-inspector`, and snapshot key `capture`.
Use one active writer per database/key, or use separate names for independent
tabs. A later writer to the same key replaces its snapshot. Browser site-data
controls can remove the database.

For another backend, pass `storage: { async load(), async save(snapshot),
async close() {} }`. `load()` returns a versioned snapshot or undefined;
`save()` replaces it atomically. Snapshots contain typed byte arrays and need a
binary-safe serialization if your backend only accepts strings. Do not mutate
the supplied snapshot. The same-origin database contains the captured URLs,
headers, and payloads; enable persistence only for traffic appropriate to retain.

## Show or hide previous page loads

The **Previous page loads** checkbox filters restored history without deleting
it. Preset it with `createInspector({ includePreviousPageLoads: false })`, or call
`inspector.setIncludePreviousPageLoads(false)`. It defaults to true.
[View preferences](preferences.md) can save this choice together with column
visibility, widths, and sorting. Preferences and traffic use separate storage
keys and lifecycles.
