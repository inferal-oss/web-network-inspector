import test from "node:test";
import assert from "node:assert/strict";
import { NetworkCapture, previewText } from "../src/network-capture.js";
import { createPersistentCapture } from "../src/storage.js";

test("spans keep one row and finish once with bounded data and measured duration", () => {
  let time = 10;
  const store = new NetworkCapture({ now: () => time, limits: { preview: 8 } });
  const parent = store.recordEvent({ label: "Click" });
  const span = store.startEvent({
    type: "report",
    label: "Build report",
    correlationId: "report-1",
    data: "starting",
  });
  const entry = store.byId.get(span.id);
  assert.equal(entry.eventSpan, true);
  assert.equal(entry.eventId, parent.id);
  assert.equal(entry.status, "Running");
  assert.equal(entry.end, undefined);
  assert.equal(typeof entry.finish, "undefined");
  assert.doesNotThrow(() => structuredClone(store.entries));
  time = 75;
  assert.equal(span.finish({ status: "Error", data: "long failure" }), entry);
  assert.equal(entry.end - entry.start, 65);
  assert.equal(entry.status, "Error");
  assert.equal(previewText(entry.body), "long fai");
  assert.equal(entry.body.truncated, true);
  assert.equal(span.finish(), null);
  assert.equal(store.entries.length, 2);
  assert.equal(store.finishEvent(parent.id), null);
});

test("span starts respect pause and completion cannot revive cleared or evicted rows", () => {
  let time = 0;
  const store = new NetworkCapture({ now: () => time, limits: { entries: 1 } });
  store.paused = true;
  assert.equal(store.startEvent(), null);
  store.paused = false;
  const first = store.startEvent({ data: "start" });
  store.paused = true;
  time = 10;
  const finished = first.finish({ data: "not captured while paused" });
  assert.equal(finished.end, 10);
  assert.equal(previewText(finished.body), "start");
  store.paused = false;
  const second = store.startEvent();
  store.recordEvent();
  assert.equal(second.finish(), null);
  const third = store.startEvent();
  store.clear();
  assert.equal(third.finish(), null);
  assert.equal(store.entries.length, 0);
});

test("spans can overlap and complete independently by ID", () => {
  let time = 0;
  const store = new NetworkCapture({ now: () => time });
  const first = store.startEvent({ label: "First", parentId: null });
  time = 5;
  const second = store.startEvent({ label: "Second", parentId: first.id });
  time = 20;
  assert.equal(store.finishEvent(first.id).end, 20);
  assert.equal(store.byId.get(second.id).end, undefined);
  time = 30;
  second.finish();
  assert.equal(
    store.byId.get(second.id).end - store.byId.get(second.id).start,
    25,
  );
});

test("persistent spans keep completed durations and interrupt unfinished spans on restoration", async () => {
  let snapshot;
  const storage = {
    load: async () => structuredClone(snapshot),
    save: async (value) => {
      snapshot = structuredClone(value);
    },
  };
  let time = 0;
  let store = await createPersistentCapture({ storage, now: () => time });
  const done = store.startEvent({ label: "Done" });
  time = 25;
  done.finish();
  store.startEvent({ label: "Interrupted" });
  await store.persistence.close();
  store = await createPersistentCapture({ storage });
  const [completed, interrupted] = store.entries;
  assert.equal(completed.eventSpan, true);
  assert.equal(completed.end - completed.start, 25);
  assert.equal(completed.status, "Complete");
  assert.equal(interrupted.status, "Interrupted by page reload");
  assert.equal(interrupted.restored, true);
  assert.ok(Number.isFinite(interrupted.end));
  assert.equal(store.finishEvent(interrupted.id), null);
  await store.persistence.close();
});
