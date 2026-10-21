import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultColumns,
  sizeSorter,
  normalizeColumns,
} from "../src/columns.js";
import {
  restoreViewState,
  createWebStorage,
  persistView,
} from "../src/view-preferences.js";

test("view snapshots restore known IDs, visibility, widths, and executable sorters from current code", () => {
  const result = restoreViewState(defaultColumns, {
    version: 1,
    columns: [
      {
        id: "size",
        width: 9000,
        sortable: true,
        hidden: false,
        flex: false,
        sort: "untrusted",
      },
      { id: "hostPath", width: 1, hidden: true },
      { id: "unknown", width: 200 },
    ],
    sorting: { id: "size", direction: "ascending" },
    includePreviousPageLoads: false,
  });
  assert.equal(result.columns[0].id, "size");
  assert.equal(result.columns[0].width, 2400);
  assert.equal(result.columns[0].sort, sizeSorter);
  assert.equal(result.columns.find((c) => c.id === "hostPath").width, 130);
  assert.equal(result.columns.find((c) => c.id === "hostPath").hidden, true);
  assert.equal(
    result.columns.some((c) => c.id === "unknown"),
    false,
  );
  assert.equal(result.sorting.compare, sizeSorter);
  assert.equal(result.sorting.direction, "ascending");
  assert.equal(result.includePreviousPageLoads, false);
});
test("invalid saved data cannot hide every column or enable a missing comparator", () => {
  assert.throws(
    () => normalizeColumns(defaultColumns.map((c) => ({ ...c, hidden: true }))),
    /visible/,
  );
  const restored = restoreViewState(defaultColumns, {
    version: 1,
    columns: defaultColumns.map((c) => ({
      id: c.id,
      hidden: true,
      width: NaN,
    })),
    sorting: { id: "size", direction: "descending" },
  });
  assert.ok(restored.columns.some((c) => !c.hidden));
  assert.equal(restored.sorting, null);
  const disabled = restoreViewState(defaultColumns, {
    version: 1,
    columns: [{ id: "size", sortable: false }],
    sorting: { id: "size", direction: "ascending" },
  });
  assert.equal(disabled.columns.find((c) => c.id === "size").sort, false);
  assert.equal(disabled.sorting, null);
  const malformed = restoreViewState(
    defaultColumns,
    { version: 99, columns: [] },
    false,
  );
  assert.equal(malformed.includePreviousPageLoads, false);
  assert.equal(malformed.columns.length, 5);
});
test("Web Storage adapters isolate keys, handle null, and surface malformed JSON", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const first = createWebStorage({ storage, key: "one" }),
    second = createWebStorage({ storage: () => storage, key: "two" });
  first.save({ version: 1, columns: [] });
  second.save(null);
  assert.deepEqual(first.load(), { version: 1, columns: [] });
  assert.equal(second.load(), null);
  first.clear();
  assert.equal(first.load(), null);
  values.set("one", "{invalid");
  assert.throws(() => first.load(), SyntaxError);
});
function viewFixture(storage, loadError) {
  let listener;
  const inspector = {
    subscribeView(fn) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
  const preferences = persistView(
    inspector,
    storage,
    new EventTarget(),
    loadError,
  );
  return { preferences, emit: (value) => listener?.(value) };
}
test("preference writes are coalesced and clear cannot resurrect an older in-flight write", async () => {
  let saved, release, started;
  const began = new Promise((resolve) => (started = resolve)),
    gate = new Promise((resolve) => (release = resolve));
  const { preferences, emit } = viewFixture({
    async save(value) {
      started();
      await gate;
      saved = value;
    },
    clear() {
      saved = null;
    },
  });
  emit({ version: 1, columns: [{ id: "a", width: 100 }] });
  emit({ version: 1, columns: [{ id: "a", width: 200 }] });
  const writing = preferences.flush();
  await began;
  emit({ version: 1, columns: [{ id: "a", width: 300 }] });
  const cleared = preferences.clear();
  release();
  await writing;
  await cleared;
  assert.equal(saved, null);
  await preferences.close();
  emit({ version: 1 });
  await preferences.flush();
  assert.equal(saved, null);
});
test("preference errors are reported without rejecting flush or breaking view changes", async () => {
  let fail = true;
  const { preferences, emit } = viewFixture(
    {
      save() {
        if (fail) throw Error("Quota exceeded");
      },
    },
    "Storage blocked",
  );
  assert.equal(preferences.status, "Unavailable");
  emit({ version: 1 });
  await preferences.flush();
  assert.match(preferences.error, /Quota exceeded/);
  fail = false;
  emit({ version: 1 });
  await preferences.flush();
  assert.equal(preferences.status, "Ready");
  assert.equal(preferences.error, null);
  await preferences.close();
});
