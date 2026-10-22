# Events that take time

Use `recordEvent` for a point in time, and `startEvent` for work with a beginning
and an end. A span stays in one `kind: "event"` row. Its waterfall bar grows while
running; finishing fixes its measured duration and updates the same row.

```js
const span = inspector.startEvent({
  type: "report.build",
  label: "Build report",
  correlationId: "report-42",
  parentId: null,
  data: JSON.stringify({ format: "pdf" }),
});

try {
  const report = await buildReport();
  span?.finish({ data: JSON.stringify({ rows: report.rows.length }) });
} catch (error) {
  span?.finish({ status: "Error", data: String(error) });
  throw error;
}
```

`startEvent` accepts the same metadata as `recordEvent`. It returns a small,
frozen handle `{ id, finish(options) }`, or null when recording is paused. Use
optional chaining so instrumentation does not prevent your application work.
The handle is separate from the retained record and is never stored in a
snapshot. You can also finish with `inspector.finishEvent(span.id, options)`.
Both methods are available on `NetworkCapture` for headless use and through
the React component's ref.

## Finish and inspect

`finish({ status = "Complete", data })` returns the updated retained entry, or
null if it has already finished, expired, or been cleared. Finish is idempotent:
a second call does not change timing, status, or payload. `status` is bounded to
80 characters; use labels such as `Error` or `Cancelled` for your application.
A supplied `data` replaces the starting payload and follows the usual body
preview limits. Omit it to keep the original payload. Serialize JSON explicitly.

The entry has `eventSpan: true`, `start`, and `status: "Running"` until finish.
It then gains `end` and its final status. `end - start` is elapsed milliseconds,
measured by the capture store's clock. Multiple spans can overlap and finish
independently. Starting or finishing a span does not run your operation, cancel
it, or change how errors propagate.

## Timeline behavior

Follow waterfall shows new span rows. Active spans have a minimum five-second
auto-scaled window so short operations visibly grow instead of immediately
filling the entire chart. Selecting or browsing holds the rows and time scale.
Span bars continue growing within that held scale, and final status updates in
place. A bar reaching the right edge can remain running; inspect its status or
use Jump to latest to rescale. Completed spans keep their actual duration.

The demo's **Start event span**, **Finish event span**, and **Run a 3-second
span** controls exercise the same API. Activity Insight shows a running badge
or the final status and duration. Try the dark theme or custom-details switch
while a span runs. For a focused view, turn off Previous page loads and choose
Application events in the activity filter.

## Retention, pause, and persistence

Spans share the existing entry count, body byte limits, and retention policy.
Cleared or evicted spans cannot be revived by delayed finish calls. Starting
while paused returns null. Finishing an already-retained span while paused
still closes its timing and status, but does not capture a replacement payload.
Application events, including spans, follow the existing event behavior and are
not excluded by transport URL filters.

Persistent capture restores completed durations. An unfinished saved span is
marked `Interrupted by page reload` and ends at its last saved snapshot time.
It does not resume after reload. A restored interrupted span cannot be finished
again. Keep snapshots only for data appropriate to retain.

The default parent is the most recent event in the current JavaScript task,
just like `recordEvent`. This does not establish asynchronous context. Pass
`parentId: span.id` to explicit child events or spans after an `await`, and use
correlation IDs to associate related work. Finish does not create a second
point event or infer causality for unrelated requests.
