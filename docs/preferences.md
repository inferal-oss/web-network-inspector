# Remember the inspector view

Column visibility, order, resized widths, sortability, active sorting, and the
**Previous page loads** checkbox can survive reloads. View settings are small
JSON objects, stored separately from [captured history](storage.md). Rendering
and sorting functions always come from your application's column definitions.

## Restore before mounting

```js
import {
  createPersistentInspector,
  createWebStorage,
} from "web-network-inspector";

const inspector = await createPersistentInspector({
  open: true,
  columns: myColumns, // Use stable IDs, including hidden custom columns.
  includePreviousPageLoads: false, // Initial preset; saved settings take priority.
  storage: createWebStorage({ key: "my-app:inspector-view" }),
});
```

Awaiting this factory loads settings before mounting or starting capture. All
other options match `createInspector`. Without `storage`, it uses localStorage
with key `web-network-inspector:view`. Ordinary `createInspector` remains
synchronous and keeps settings in memory unless you save them yourself.

The [demo](https://oss.inferal.org/web-network-inspector/demo/) stores its view in
localStorage and its retained traffic in IndexedDB. Its theme switch uses a
separate application-owned localStorage key.

## Choose storage

`createWebStorage({ storage, key })` adapts localStorage, sessionStorage, or an
object implementing `getItem`, `setItem`, and `removeItem`. `storage` may also be
a function, so a blocked browser storage getter is evaluated during load and its
error can be handled by the factory.

```js
const inspector = await createPersistentInspector({
  storage: createWebStorage({
    storage: () => window.sessionStorage,
    key: "inspector:view",
  }),
});
```

For IndexedDB, use a separate database or key from captured history:

```js
import {
  createPersistentInspector,
  createIndexedDBStorage,
} from "web-network-inspector";

const inspector = await createPersistentInspector({
  storage: createIndexedDBStorage({
    database: "my-inspector-settings",
    key: "view",
  }),
});
```

A custom adapter needs `load()` and `save(snapshot)`. Both can be asynchronous.
`load()` returns a snapshot or null/undefined; `save()` replaces the stored
value. Optional `clear()` removes it, and optional `close()` releases resources.
Without `clear()`, clearing saves null. Use one active writer per key; this API
does not merge simultaneous edits from different tabs.

## Lifecycle and errors

`inspector.preferences` exposes:

- `status`: `Ready` or `Unavailable`.
- `error`: the latest storage error message, or null.
- `flush()`: await pending writes, including a queued write behind another save.
- `clear()`: discard pending saves and remove stored settings after any in-flight save.
- `close()`: unsubscribe, flush, and close the adapter; repeated calls share completion.

The default localStorage adapter and adapters made with `createWebStorage()`
save each change immediately, so a quick reload keeps the latest checkbox,
column, and sorting settings. Other adapters coalesce writes over 150 ms.
The factory attempts to flush on `pagehide`, but browser shutdown can interrupt
asynchronous storage. Await `flush()` before
controlled navigation when completion matters. Storage errors leave the
inspector usable; a successful later write clears the error. Malformed JSON
falls back to defaults with `Unavailable`; unsupported snapshot versions are
ignored. `destroy()` starts closing preferences. Await `preferences.close()`
when you need confirmed completion before destroying its owner.

Clearing stored settings does not change the running view. To reset both:

```js
inspector.setColumns(myDefaultColumns);
inspector.setIncludePreviousPageLoads(true);
await inspector.preferences.clear();
```

## Manage state yourself

Every inspector, including the React component's API, exposes:

```js
const snapshot = inspector.getViewState(); // JSON only, version: 1.
inspector.setViewState(snapshot);
const unsubscribe = inspector.subscribeView((nextSnapshot) => {
  // Called on settings changes, not on each captured request.
  saveSettings(nextSnapshot);
});
```

Use `createInspector({ viewState: snapshot })` for preloaded settings. Each
snapshot contains `columns` with `id`, `width`, `flex`, `hidden`, and `sortable`;
`sorting` with `{ id, direction: "ascending" | "descending" }` or null; and
`includePreviousPageLoads`. Widths are clamped to the current definitions.
Unknown or duplicate IDs are ignored, newly introduced columns are appended,
and at least one column remains visible. Removed known columns are saved as
hidden so they can be restored later. A saved flag can disable a comparator,
but cannot supply or invent one. Sorting is restored only for a visible column
whose current definition supplies a comparator. No functions are serialized.

Supply the complete catalog up front, with `hidden: true` for optional columns,
to restore those columns after reload. New custom definitions can also be
registered with `setColumns`; the catalog supports at most 24 IDs.

## Previous page loads

The inspector's **Previous page loads** checkbox controls whether restored
entries are shown. Its initial default is true. Preset it with
`includePreviousPageLoads: false`, or use:

```js
inspector.setIncludePreviousPageLoads(false);
console.log(inspector.getIncludePreviousPageLoads());
```

This setting filters the view. It does not delete retained history, change
capture, or change retention limits. Turning it back on reveals retained rows.
It is included in view snapshots and saved by `createPersistentInspector`.
