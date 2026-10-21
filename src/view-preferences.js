import { normalizeColumns } from "./columns.js";

/** JSON-only settings; executable renderers and comparators always come from the application. */
export function restoreViewState(
  columns,
  snapshot,
  includePreviousPageLoads = true,
) {
  const defaults = normalizeColumns(columns);
  if (
    snapshot?.version !== 1 ||
    !Array.isArray(snapshot.columns) ||
    snapshot.columns.length > 24
  )
    return { columns: defaults, sorting: null, includePreviousPageLoads };
  const known = new Map(defaults.map((column) => [column.id, column]));
  const used = new Set(),
    restored = [];
  for (const saved of snapshot.columns) {
    const column = known.get(saved?.id);
    if (!column || used.has(column.id)) continue;
    used.add(column.id);
    restored.push({
      ...column,
      hidden: typeof saved.hidden === "boolean" ? saved.hidden : column.hidden,
      width: Number.isFinite(saved.width)
        ? Math.max(
            column.minWidth,
            Math.min(column.maxWidth, Math.round(saved.width)),
          )
        : column.width,
      flex: typeof saved.flex === "boolean" ? saved.flex : column.flex,
      sort: saved.sortable === false ? false : column.sort,
    });
  }
  restored.push(...defaults.filter((column) => !used.has(column.id)));
  if (!restored.some((column) => !column.hidden))
    restored[0] = { ...restored[0], hidden: false };
  const selected = restored.find(
    (column) =>
      column.id === snapshot.sorting?.id &&
      !column.hidden &&
      typeof column.sort === "function",
  );
  const sorting =
    selected &&
    ["ascending", "descending"].includes(snapshot.sorting?.direction)
      ? {
          id: selected.id,
          compare: selected.sort,
          direction: snapshot.sorting.direction,
        }
      : null;
  return {
    columns: normalizeColumns(restored),
    sorting,
    includePreviousPageLoads:
      typeof snapshot.includePreviousPageLoads === "boolean"
        ? snapshot.includePreviousPageLoads
        : includePreviousPageLoads,
  };
}

/** Adapt localStorage, sessionStorage, or a Storage-compatible object to load/save/clear. */
export function createWebStorage({
  storage,
  key = "web-network-inspector:view",
} = {}) {
  if (typeof key !== "string" || !key)
    throw new TypeError("Storage key must be a nonempty string.");
  const backend = () =>
    typeof storage === "function"
      ? storage()
      : (storage ?? globalThis.localStorage);
  return {
    load() {
      const value = backend().getItem(key);
      return value == null ? null : JSON.parse(value);
    },
    save(value) {
      backend().setItem(key, JSON.stringify(value));
    },
    clear() {
      backend().removeItem(key);
    },
  };
}

/** Serialize asynchronous writes and keep view persistence independent of captured traffic. */
export function persistView(inspector, storage, scope, loadError = null) {
  let timer = null,
    pending = null,
    closed = false,
    closing = null;
  let tail = Promise.resolve();
  const state = {
    status: loadError ? "Unavailable" : "Ready",
    error: loadError,
  };
  const failure = (error) => {
    state.status = "Unavailable";
    state.error = String(error?.message ?? error);
  };
  function enqueue(action) {
    const run = async () => {
      try {
        await action();
        state.status = "Ready";
        state.error = null;
      } catch (error) {
        failure(error);
      }
    };
    tail = tail.then(run);
    return tail;
  }
  function flush() {
    clearTimeout(timer);
    timer = null;
    const next = pending;
    pending = null;
    return next ? enqueue(() => storage.save(next)) : tail;
  }
  const unsubscribe = inspector.subscribeView((snapshot) => {
    if (closed) return;
    pending = snapshot;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, 150);
  });
  const pagehide = () => {
    void flush();
  };
  scope?.addEventListener?.("pagehide", pagehide);
  return Object.assign(state, {
    flush,
    clear() {
      clearTimeout(timer);
      timer = null;
      pending = null;
      return enqueue(() =>
        typeof storage.clear === "function"
          ? storage.clear()
          : storage.save(null),
      );
    },
    close() {
      if (closing) return closing;
      closed = true;
      unsubscribe();
      scope?.removeEventListener?.("pagehide", pagehide);
      closing = flush().then(async () => {
        try {
          await storage.close?.();
        } catch (error) {
          failure(error);
        }
      });
      return closing;
    },
  });
}
