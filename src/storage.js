import {
  NetworkCapture,
  previewParts,
  retentionBounds,
} from "./network-capture.js";

/** One named IndexedDB snapshot; values use structured clone, including body bytes. */
export function createIndexedDBStorage({
  indexedDB = globalThis.indexedDB,
  database = "web-network-inspector",
  key = "capture",
} = {}) {
  let connection;
  const open = () =>
    (connection ??= new Promise((resolve, reject) => {
      if (!indexedDB) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("snapshots");
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("IndexedDB is blocked by another tab."));
    }));
  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", mode);
      const request = action(tx.objectStore("snapshots"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () =>
        reject(
          tx.error ??
            request.error ??
            new Error("IndexedDB transaction failed."),
        );
    });
  }
  return {
    load: () => transaction("readonly", (store) => store.get(key)),
    save: (snapshot) =>
      transaction("readwrite", (store) => store.put(snapshot, key)),
    async close() {
      if (connection) (await connection).close();
    },
  };
}

/** Restore before capture starts, then save bounded snapshots as the store changes. */
export async function createPersistentCapture({
  storage = createIndexedDBStorage(),
  maxAge = 24 * 60 * 60 * 1000,
  ...options
} = {}) {
  if (!Number.isSafeInteger(maxAge) || maxAge < 1)
    throw new RangeError("maxAge must be a positive number of milliseconds.");
  if (
    typeof storage?.load !== "function" ||
    typeof storage?.save !== "function"
  )
    throw new TypeError("storage requires load() and save(snapshot).");
  const store = new NetworkCapture(options);
  const persistence = { status: "Loading", error: null, maxAge };
  store.persistence = persistence;
  try {
    const snapshot = await storage.load();
    if (snapshot?.version === 1 && Array.isArray(snapshot.entries)) {
      const limits = Object.fromEntries(
        Object.entries(snapshot.limits ?? {}).filter(
          ([key, value]) =>
            Object.hasOwn(retentionBounds, key) &&
            Number.isSafeInteger(value) &&
            value > 0 &&
            value <= retentionBounds[key],
        ),
      );
      store.setLimits({
        ...limits,
        ...(options.limits &&
          Object.fromEntries(
            Object.entries(options.limits).filter(([key]) => key !== "readers"),
          )),
      });
      const ids = new Map(),
        rejectedConnections = new Set();
      const cutoff = Date.now() - maxAge;
      for (const original of snapshot.entries.slice(-store.limits.entries)) {
        if (
          !original ||
          !["http", "socket", "message", "resource", "event"].includes(
            original.kind,
          ) ||
          !Number.isFinite(original.capturedAt) ||
          original.capturedAt < cutoff ||
          original.capturedAt > Date.now() + 60000
        )
          continue;
        if (
          original.kind === "message" &&
          rejectedConnections.has(original.connection)
        )
          continue;
        const data = {};
        for (const [key, value] of Object.entries(original)) {
          if (
            [
              "__proto__",
              "constructor",
              "prototype",
              "id",
              "generation",
              ...previewParts,
            ].includes(key)
          )
            continue;
          if (typeof value === "string") data[key] = value.slice(0, 8192);
          else if (
            value === null ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value))
          )
            data[key] = value;
        }
        const start = original.capturedAt - store.timeOrigin;
        for (const key of ["end", "headersAt", "openedAt", "networkStart"])
          if (Number.isFinite(original[key]) && Number.isFinite(original.start))
            data[key] = start + original[key] - original.start;
        data.start = start;
        data.restored = true;
        if (data.resourcePreviewStatus === "Loading")
          data.resourcePreviewStatus = "Interrupted by page reload";
        if (["http", "socket"].includes(data.kind) && data.end == null) {
          data.end = start;
          data.status = "Interrupted by page reload";
        }
        if (data.kind === "event" && data.eventSpan && data.end == null) {
          data.end =
            start +
            Math.max(
              0,
              (Number.isFinite(snapshot.savedAt)
                ? snapshot.savedAt
                : original.capturedAt) - original.capturedAt,
            );
          data.status = "Interrupted by page reload";
        }
        for (const key of ["connection", "eventId", "nearEvent"])
          if (data[key] != null) data[key] = ids.get(data[key]) ?? null;
        const entry = store.add(data);
        if (!entry) {
          if (original.kind === "socket" && !original.connection)
            rejectedConnections.add(original.id);
          continue;
        }
        ids.set(original.id, entry.id);
        for (const part of previewParts) {
          const preview = original[part];
          if (!(preview?.bytes instanceof Uint8Array)) continue;
          store.preview(entry, part, {
            bytes: preview.expired === true ? new Uint8Array() : preview.bytes,
            size:
              Number.isFinite(preview.size) && preview.size >= 0
                ? preview.size
                : null,
            text: preview.text === true,
            contentType: String(preview.contentType ?? "").slice(0, 128),
            truncated:
              preview.truncated === true ||
              preview.bytes.length > store.limits.preview,
            expired: preview.expired === true,
            ...(preview.note
              ? { note: String(preview.note).slice(0, 2048) }
              : {}),
          });
        }
      }
    }
    persistence.status = "Ready";
  } catch (error) {
    persistence.status = "Unavailable";
    persistence.error = error.message;
  }
  store.activeEvent = null;
  store.lastEvent = null;
  let revision = 1,
    saved = 0,
    pending = null,
    timer = null,
    closed = false,
    notifying = false;
  function notify() {
    notifying = true;
    try {
      store.changed();
    } finally {
      notifying = false;
    }
  }
  function snapshot() {
    return {
      version: 1,
      savedAt: Date.now(),
      limits: Object.fromEntries(
        Object.entries(store.limits).filter(([key]) => key !== "readers"),
      ),
      entries: store.entries.filter(
        (entry) => entry.capturedAt >= Date.now() - maxAge,
      ),
    };
  }
  function schedule() {
    if (!closed && !timer)
      timer = setTimeout(() => {
        timer = null;
        void persistence.flush().catch(() => {});
      }, 250);
  }
  persistence.flush = async () => {
    clearTimeout(timer);
    timer = null;
    if (pending) {
      await pending;
      if (saved < revision) return persistence.flush();
      return;
    }
    if (saved >= revision) return;
    const current = revision;
    // storage.save must snapshot synchronously, as IndexedDB's put does.
    pending = Promise.resolve()
      .then(() => storage.save(structuredClone(snapshot())))
      .then(
        () => {
          saved = current;
          persistence.status = "Ready";
          persistence.error = null;
          notify();
        },
        (error) => {
          saved = current;
          persistence.status = "Unavailable";
          persistence.error = error.message;
          notify();
          throw error;
        },
      )
      .finally(() => {
        pending = null;
        if (saved < revision) schedule();
      });
    await pending;
    if (saved < revision) return persistence.flush();
  };
  const off = store.subscribe(() => {
    if (notifying) return;
    revision++;
    schedule();
  });
  persistence.clear = async () => {
    store.clear();
    await persistence.flush();
  };
  persistence.close = async () => {
    if (closed) return;
    closed = true;
    off();
    clearTimeout(timer);
    try {
      await persistence.flush();
    } finally {
      await storage.close?.();
    }
  };
  // Persist pruned/trimmed history too, including an empty or expired snapshot.
  schedule();
  return store;
}
