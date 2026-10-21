import test from "node:test";
import assert from "node:assert/strict";
import { createPersistentCapture } from "../src/storage.js";
import { bodyPreview, previewText } from "../src/network-capture.js";
function memory() {
  let value;
  return {
    load: async () => structuredClone(value),
    save: async (snapshot) => {
      value = structuredClone(snapshot);
    },
  };
}
test("persistent capture restores bounded body bytes, headers, content types, limits, and linked IDs", async () => {
  const storage = memory();
  let store = await createPersistentCapture({
    storage,
    limits: { preview: 8, entries: 3 },
  });
  const event = store.recordEvent({ label: "Request" });
  const entry = store.add({
    kind: "http",
    method: "GET",
    url: "https://example.com",
    eventId: event.id,
    requestHeaders: "accept: text/plain",
    responseHeaders: "content-type: text/plain",
    end: store.now(),
  });
  store.preview(
    entry,
    "responseBody",
    bodyPreview("hello world", 100, "text/plain"),
  );
  await store.persistence.close();
  store = await createPersistentCapture({ storage });
  assert.equal(store.entries.length, 2);
  assert.equal(store.limits.preview, 8);
  assert.equal(store.entries[1].eventId, store.entries[0].id);
  assert.equal(store.entries[1].responseHeaders, "content-type: text/plain");
  assert.equal(previewText(store.entries[1].responseBody), "hello wo");
  assert.equal(store.entries[1].responseBody.contentType, "text/plain");
  assert.equal(store.entries[1].responseBody.truncated, true);
  assert.equal(store.entries[1].restored, true);
  await store.persistence.clear();
  await store.persistence.close();
  store = await createPersistentCapture({ storage });
  assert.equal(store.entries.length, 0);
  await store.persistence.close();
});
test("persistent capture prunes expired snapshots and reapplies filters and tighter retention", async () => {
  const storage = memory();
  let store = await createPersistentCapture({ storage });
  store.add({
    kind: "http",
    url: "https://old.example",
    capturedAt: Date.now() - 100000,
  });
  store.add({ kind: "http", url: "https://denied.example" });
  store.add({ kind: "http", url: "https://allowed.example" });
  await store.persistence.close();
  store = await createPersistentCapture({
    storage,
    maxAge: 10000,
    filter: (entry) => entry.hostname === "allowed.example",
    limits: { entries: 1 },
  });
  assert.deepEqual(
    store.entries.map((entry) => entry.url),
    ["https://allowed.example"],
  );
  assert.equal(store.entries[0].status, "Interrupted by page reload");
  await store.persistence.close();
});

test("restoring tighter preview limits preserves UTF-8 boundaries", async () => {
  const storage = memory();
  let store = await createPersistentCapture({ storage });
  store.recordEvent({ label: "Unicode", data: "éé" });
  await store.persistence.close();
  store = await createPersistentCapture({ storage, limits: { preview: 3 } });
  assert.equal(previewText(store.entries[0].body), "é");
  assert.equal(store.entries[0].body.truncated, true);
  await store.persistence.close();
});
test("clear during a pending storage write cannot restore stale data; failures remain visible", async () => {
  let saved, finish;
  const storage = {
    load: async () => null,
    save: (snapshot) =>
      new Promise((resolve) => {
        saved = snapshot;
        finish = resolve;
      }),
  };
  const store = await createPersistentCapture({ storage });
  store.recordEvent({ label: "old" });
  const first = store.persistence.flush();
  await new Promise((resolve) => setImmediate(resolve));
  store.clear();
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved.entries.length, 0);
  finish();
  await first;
  await store.persistence.close();
  const unavailable = await createPersistentCapture({
    storage: {
      load: async () => {
        throw new Error("blocked");
      },
      save: async () => {
        throw new Error("quota");
      },
    },
  });
  assert.equal(unavailable.persistence.status, "Unavailable");
  unavailable.recordEvent({ label: "still records" });
  await assert.rejects(unavailable.persistence.flush(), /quota/);
  assert.equal(unavailable.entries.length, 1);
  assert.equal(unavailable.persistence.error, "quota");
  await unavailable.persistence.close();
});

test("a resource preview interrupted by reload can be retried", async () => {
  const storage = memory();
  let store = await createPersistentCapture({ storage });
  store.add({
    kind: "resource",
    url: "https://example.com/app.css",
    resourcePreviewStatus: "Loading",
  });
  await store.persistence.close();
  store = await createPersistentCapture({ storage });
  assert.equal(
    store.entries[0].resourcePreviewStatus,
    "Interrupted by page reload",
  );
  await store.persistence.close();
});
