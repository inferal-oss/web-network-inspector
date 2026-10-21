import { previewParts } from "./network-capture.js";
import { createDetailView } from "./detail-renderer.js";

const bytes = (value) =>
  value == null
    ? "unknown size"
    : value < 1024
      ? `${value} B`
      : `${(value / 1024).toFixed(1)} KiB`;
const ms = (value) => `${value.toFixed(1)} ms`;
function text(node, value) {
  if (node.textContent !== value) node.textContent = value;
}
function name(entry) {
  if (entry.kind === "event") return entry.label;
  if (["message", "socket"].includes(entry.kind) && entry.label)
    return entry.label;
  if (entry.kind === "message")
    return `${entry.direction === "out" ? "↑" : "↓"} ${entry.protocol || "Message"}`;
  try {
    const url = new URL(entry.url);
    return `${entry.method || "WS"} ${url.pathname}${url.search}`;
  } catch {
    return entry.url;
  }
}
function host(entry) {
  if (entry.kind === "event") return "";
  try {
    return new URL(entry.url).host;
  } catch {
    return "";
  }
}
export function activitySize(entry) {
  const size =
    entry.body?.size ?? entry.responseBody?.size ?? entry.transferSize;
  return Number.isFinite(size) && size >= 0 ? size : null;
}
export function sortActivity(entries, order = "time") {
  const time = (a, b) => a.start - b.start || a.id - b.id;
  return [...entries].sort((a, b) => {
    if (order === "time") return time(a, b);
    const left = activitySize(a),
      right = activitySize(b);
    if (left === null || right === null)
      return left === right ? time(a, b) : left === null ? 1 : -1;
    return (order === "largest" ? right - left : left - right) || time(a, b);
  });
}
export function timelinePosition(entry, start, end, now) {
  const span = Math.max(1, end - start),
    left = Math.max(0, Math.min(100, ((entry.start - start) / span) * 100));
  return {
    left,
    width: Math.max(
      0,
      Math.min(100 - left, (((entry.end ?? now) - entry.start) / span) * 100),
    ),
  };
}

/** Mount the retained waterfall inside an inspector's own root. */
export function setupNetworkActivity(root, scope, store, options = {}) {
  const document = root.ownerDocument;
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  };
  const get = (id) => root.getElementById(id);
  const cleanup = [];
  const detailView = createDetailView(root.getElementById("network-detail"), {
    ...options,
    scope,
    store,
    root,
    name,
    select: (id) => select(id),
    showMessages: (id) => {
      connection.value = String(id);
      filter.value = "message";
      resetView();
      dirty = true;
      render();
    },
  });
  cleanup.push(() => detailView.destroy());
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    if (target === scope)
      cleanup.push(() => target.removeEventListener(type, fn, options));
  };
  const panel = get("network-activity");
  const toggle = get("network-toggle"),
    body = get("network-body");
  const list = get("network-rows"),
    detail = get("network-detail");
  const count = get("network-count"),
    summary = get("network-summary");
  const search = get("network-search"),
    filter = get("network-filter");
  const follow = get("network-follow"),
    pause = get("network-pause");
  const older = get("network-older"),
    newer = get("network-newer");
  const latest = get("network-latest");
  const connection = get("network-connection");
  const sortSize = get("network-sort-size");
  const resize = get("network-resize");
  const retentionForm = get("network-retention-form"),
    retentionStatus = get("network-retention-status");
  const retentionControls = ["entries", "messages", "preview", "bytes"].map(
    (key) => ({
      key,
      input: get(`network-limit-${key}`),
      scale: key === "preview" ? 1024 : key === "bytes" ? 1024 * 1024 : 1,
    }),
  );
  for (const { key, input, scale } of retentionControls)
    input.value = String(store.limits[key] / scale);
  listen(retentionForm, "submit", (event) => {
    event.preventDefault();
    if (!retentionForm.reportValidity()) return;
    try {
      store.setLimits(
        Object.fromEntries(
          retentionControls.map(({ key, input, scale }) => [
            key,
            Number(input.value) * scale,
          ]),
        ),
      );
      retentionStatus.textContent = "Limits applied";
      dirty = true;
      render();
    } catch {
      retentionStatus.textContent =
        "Enter whole numbers within the shown limits.";
    }
  });
  listen(retentionForm, "input", () => {
    retentionStatus.textContent = "Changes not applied";
  });
  let selected = null,
    open = false,
    dirty = true,
    detailRevision = "",
    timer = null,
    sizeOrder = "time";
  let view = null,
    frozen = false,
    navigation = null;
  let pointerOverList = false,
    listFocused = false,
    pointerPressed = false,
    releasePointer = null;
  const rows = new Map();
  cleanup.push(
    store.subscribe(() => {
      dirty = true;
    }),
  );
  const browsing = () =>
    pointerPressed ||
    selected !== null ||
    pointerOverList ||
    listFocused ||
    !follow.checked;
  function freezeView() {
    if (view) frozen = true;
  }
  function resetView() {
    view = null;
    frozen = false;
    navigation = null;
  }
  listen(list, "pointerenter", () => {
    pointerOverList = true;
    freezeView();
  });
  listen(list, "pointerleave", () => {
    pointerOverList = false;
    dirty = true;
  });
  listen(list, "focusin", (event) => {
    listFocused = event.target.matches(":focus-visible");
    if (listFocused) freezeView();
  });
  listen(list, "focusout", (event) => {
    listFocused = list.contains(event.relatedTarget);
    dirty = true;
  });
  listen(list, "pointerdown", (event) => {
    if (event.button !== 0) return;
    clearTimeout(releasePointer);
    pointerPressed = true;
    listFocused = false;
    freezeView();
  });
  function finishPointer() {
    if (!pointerPressed) return;
    // Keep the original target connected through pointerup AND the ensuing click.
    clearTimeout(releasePointer);
    releasePointer = setTimeout(() => {
      pointerPressed = false;
      dirty = true;
      render();
    }, 0);
  }
  listen(scope, "pointerup", finishPointer, true);
  listen(scope, "pointercancel", finishPointer, true);
  listen(scope, "blur", finishPointer);
  function setOpen(value) {
    open = value;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("expanded", open);
    dirty = true;
    resize.hidden = !open;
    get("network-close").hidden = !open;
    if (open) {
      resize.setAttribute("aria-valuemin", "260");
      resize.setAttribute(
        "aria-valuemax",
        String(Math.round(scope.innerHeight * 0.85)),
      );
      resize.setAttribute(
        "aria-valuenow",
        String(Math.round(body.getBoundingClientRect().height)),
      );
    }
    clearInterval(timer);
    timer = open ? setInterval(render, 150) : null;
    render();
  }
  listen(toggle, "click", () => setOpen(!open));
  function resizeTo(height) {
    const value = Math.max(260, Math.min(scope.innerHeight * 0.85, height));
    body.style.height = `${value}px`;
    resize.setAttribute("aria-valuenow", String(Math.round(value)));
    dirty = true;
  }
  let drag = null;
  listen(resize, "pointerdown", (event) => {
    drag = { y: event.clientY, height: body.getBoundingClientRect().height };
    resize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  listen(resize, "pointermove", (event) => {
    if (drag) resizeTo(drag.height + drag.y - event.clientY);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(resize, type, () => {
      drag = null;
    });
  listen(resize, "keydown", (event) => {
    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      resizeTo(
        body.getBoundingClientRect().height +
          (event.key === "ArrowUp" ? 30 : -30),
      );
    }
  });

  listen(get("network-close"), "click", () => {
    setOpen(false);
    toggle.focus();
  });
  listen(panel, "keydown", (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      toggle.focus();
    }
  });
  listen(get("network-clear"), "click", () => {
    store.clear();
    void store.persistence?.flush().catch(() => {});
    selected = null;
    resetView();
    follow.checked = true;
    sizeOrder = "time";
    renderSortControl();
    detailRevision = "";
    render();
  });
  listen(pause, "click", () => {
    store.paused = !store.paused;
    pause.innerHTML = store.paused
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 8 5-8 5Z" fill="currentColor" stroke="none"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" stroke-width="2.5"/></svg>';
    const label = store.paused ? "Resume recording" : "Pause recording";
    pause.setAttribute("aria-label", label);
    pause.title = label;
    pause.setAttribute("aria-pressed", String(store.paused));
    dirty = true;
    render();
  });
  for (const control of [search, filter, connection])
    listen(control, "input", () => {
      resetView();
      dirty = true;
      render();
    });
  function renderSortControl() {
    sortSize.textContent = `Size ${sizeOrder === "time" ? "↕" : sizeOrder === "largest" ? "↓" : "↑"}`;
    const label =
      sizeOrder === "time"
        ? "Sort by size, largest first"
        : sizeOrder === "largest"
          ? "Size: largest first. Sort smallest first"
          : "Size: smallest first. Restore time order";
    sortSize.setAttribute("aria-label", label);
    sortSize.title = label;
    sortSize.setAttribute("aria-pressed", String(sizeOrder !== "time"));
  }
  listen(sortSize, "click", () => {
    sizeOrder =
      sizeOrder === "time"
        ? "largest"
        : sizeOrder === "largest"
          ? "smallest"
          : "time";
    if (sizeOrder !== "time") follow.checked = false;
    resetView();
    renderSortControl();
    dirty = true;
    render();
    list.scrollTop = 0;
  });
  listen(follow, "change", () => {
    if (follow.checked) {
      resetView();
      sizeOrder = "time";
      renderSortControl();
    } else freezeView();
    dirty = true;
    render();
  });
  function navigate(direction) {
    const ids = view?.ids ?? [];
    resetView();
    navigation = { direction, ids };
    follow.checked = false;
    dirty = true;
    render();
    list.scrollTop = 0;
  }
  listen(older, "click", () =>
    navigate(sizeOrder === "time" ? "before" : "after"),
  );
  listen(newer, "click", () =>
    navigate(sizeOrder === "time" ? "after" : "before"),
  );
  listen(latest, "click", () => {
    selected = null;
    detailRevision = "";
    pointerOverList = false;
    listFocused = false;
    pointerPressed = false;
    clearTimeout(releasePointer);
    search.value = "";
    filter.value = "";
    connection.value = "";
    follow.checked = true;
    sizeOrder = "time";
    resetView();
    renderSortControl();
    dirty = true;
    render();
    detail.scrollTop = 0;
  });
  function select(id) {
    if (selected !== id) freezeView();
    selected = selected === id ? null : id;
    detailRevision = "";
    dirty = true;
    render();
    detail.scrollTop = 0;
  }
  function renderDetail(entry) {
    const revision = JSON.stringify(
      entry
        ? {
            ...entry,
            ...Object.fromEntries(
              previewParts.map((key) => [
                key,
                entry[key] && { ...entry[key], bytes: entry[key].bytes.length },
              ]),
            ),
          }
        : selected,
    );
    if (detailRevision === revision) return;
    detailRevision = revision;
    detailView.render(entry, selected);
  }

  function render() {
    text(count, `${store.entries.length}${store.paused ? " · paused" : ""}`);
    if (!open) return;
    const now = store.now(),
      live = store.entries.some(
        (e) => ["http", "socket"].includes(e.kind) && e.end == null,
      );
    if (!dirty && !live) return;
    dirty = false;
    if (browsing()) freezeView();
    else frozen = false;
    // Keep controls and row nodes stable while messages arrive, including keyboard focus.
    const known = new Set(
      [...connection.options].map((option) => option.value),
    );
    const socketIds = new Set(
      store.entries
        .filter((e) => e.kind === "socket" || e.kind === "message")
        .map((e) => String(e.connection ?? e.id)),
    );
    for (const id of socketIds)
      if (!known.has(id)) {
        const entry = store.byId.get(Number(id));
        const option = element(
          "option",
          "",
          entry
            ? `#${id} ${name(entry)}`
            : `#${id} WebSocket · connection details expired`,
        );
        option.value = id;
        connection.append(option);
      }
    for (const option of [...connection.options])
      if (
        option.value &&
        !socketIds.has(option.value) &&
        option.value !== connection.value
      )
        option.remove();
    const query = search.value.trim().toLowerCase();
    const matches = (entry) =>
      (!connection.value ||
        String(entry.connection ?? entry.id) === connection.value) &&
      (!query ||
        `${name(entry)} ${entry.url || ""} ${entry.status || ""} ${entry.correlationId || ""} ${entry.eventType || ""}`
          .toLowerCase()
          .includes(query));
    const filtered = sortActivity(
      store.entries.filter(
        (entry) =>
          (!filter.value || entry.kind === filter.value) && matches(entry),
      ),
      sizeOrder,
    );
    function bounds(ids) {
      const known = new Set(ids);
      let first = -1,
        stop = 0;
      for (let i = 0; i < filtered.length; i++)
        if (known.has(filtered[i].id)) {
          if (first < 0) first = i;
          stop = i + 1;
        }
      return { first: Math.max(0, first), stop };
    }
    let first = sizeOrder === "time" ? Math.max(0, filtered.length - 200) : 0,
      stop = Math.min(filtered.length, first + 200);
    if (navigation) {
      const anchor = bounds(navigation.ids);
      if (navigation.direction === "before") {
        stop = anchor.first;
        first = Math.max(0, stop - 200);
      } else {
        first = anchor.stop;
        stop = Math.min(filtered.length, first + 200);
      }
      navigation = null;
    }
    const visible = frozen ? [] : filtered.slice(first, stop);
    const start = frozen
      ? view.start
      : filtered.reduce(
          (value, e) => Math.min(value, e.start),
          filtered.length ? Infinity : now,
        );
    const end = frozen
      ? view.end
      : filtered.reduce(
          (value, e) =>
            Math.max(
              value,
              e.end ?? (["http", "socket"].includes(e.kind) ? now : e.start),
            ),
          start + 1,
        );
    if (!frozen) {
      const keep = new Set(visible.map((e) => e.id));
      for (const [id, row] of rows)
        if (!keep.has(id)) {
          row.remove();
          rows.delete(id);
        }
      // Hold only IDs and the timeline scale. Expired payloads stay subject to capture limits.
      view = { ids: visible.map((e) => e.id), start, end, fence: store.serial };
    }
    ({ first, stop } = bounds(view.ids));
    text(
      get("network-range"),
      start < 0
        ? "Retained history · includes previous page loads"
        : `${ms(start)} → ${ms(end)} since page load`,
    );
    const newCount = Math.max(0, store.serial - view.fence);
    const browsingStatus =
      frozen || browsing()
        ? `browsing ${view.ids.length} fixed rows · ${view.ids.filter((id) => !store.byId.has(id)).length} rows no longer retained`
        : `showing ${view.ids.length ? first + 1 : 0}–${stop}`;
    const storageStatus = store.persistence
      ? store.persistence.status === "Ready"
        ? " · local history enabled"
        : " · local history unavailable"
      : "";
    summary.textContent = `${filtered.length} matching · ${bytes(store.bytes)} previews · ${store.expired} entries expired · ${store.expiredPreviews} previews expired · ${browsingStatus}${storageStatus}`;
    latest.hidden = !(frozen || browsing());
    text(latest, `${newCount} new · Jump to latest`);
    older.disabled =
      sizeOrder === "time" ? first === 0 : stop === filtered.length;
    newer.disabled =
      sizeOrder === "time" ? stop === filtered.length : first === 0;
    older.textContent = sizeOrder === "time" ? "Older" : "Next";
    newer.textContent = sizeOrder === "time" ? "Newer" : "Previous";
    if (!frozen) list.querySelector(".network-empty")?.remove();
    let previous = null;
    for (const entry of visible) {
      let row = rows.get(entry.id);
      if (!row) {
        row = element("button", "network-row");
        row.type = "button";
        row.dataset.kind = entry.kind;
        for (const cls of [
          "network-row-name",
          "network-row-status",
          "network-row-size",
          "network-track",
        ])
          row.append(element("span", cls));
        row.firstChild.append(
          element("span", "network-row-label"),
          element("span", "network-row-host"),
        );
        const id = entry.id;
        row.lastChild.append(element("i"));
        listen(row, "click", () => select(id));
        rows.set(id, row);
      }
      if (row.previousElementSibling !== previous || row.parentElement !== list)
        list.insertBefore(
          row,
          previous ? previous.nextSibling : list.firstChild,
        );
      previous = row;
      const label = name(entry);
      text(row.firstChild.firstChild, `#${entry.id} ${label}`);
      const rowHost = row.firstChild.lastChild,
        hostname = host(entry);
      text(rowHost, hostname);
      rowHost.hidden = !hostname;
      row.title = entry.url ? `${label}\n${entry.url}` : label;
      text(
        row.children[1],
        String(entry.status ?? (entry.kind === "event" ? "Event" : "")),
      );
      text(
        row.children[2],
        bytes(
          entry.body?.size ?? entry.responseBody?.size ?? entry.transferSize,
        ),
      );
      const bar = row.lastChild.firstChild,
        pos = timelinePosition(entry, start, end, now);
      bar.style.left = `${pos.left}%`;
      bar.style.width =
        entry.socketEvent || ["event", "message"].includes(entry.kind)
          ? "3px"
          : `max(3px, ${pos.width}%)`;
      row.lastChild.title = `${ms(entry.start - start)} after timeline start${entry.end != null ? ` · ${ms(entry.end - entry.start)}` : ""}`;
    }
    for (const [id, row] of rows) {
      const pressed = String(selected === id);
      if (row.getAttribute("aria-pressed") !== pressed)
        row.setAttribute("aria-pressed", pressed);
    }
    if (!frozen && !visible.length) {
      const empty = element(
        "div",
        "network-empty",
        store.entries.length
          ? "No retained activity matches these filters."
          : store.paused
            ? "Recording paused. Resume to capture new traffic."
            : "No activity captured yet.",
      );
      if (store.entries.length) {
        const reset = element("button", "text-button", "Reset filters");
        reset.type = "button";
        listen(reset, "click", () => {
          search.value = "";
          filter.value = "";
          connection.value = "";
          resetView();
          dirty = true;
          render();
        });
        empty.append(reset);
      }
      list.append(empty);
    }
    if (browsing()) freezeView();
    if (!browsing() && follow.checked) list.scrollTop = list.scrollHeight;
    renderDetail(store.byId.get(selected));
  }
  const counterTimer = setInterval(() => {
    if (!open && dirty) {
      render();
      dirty = false;
    }
  }, 500);
  return {
    setOpen,
    render,
    select,
    destroy() {
      clearInterval(timer);
      clearInterval(counterTimer);
      clearTimeout(releasePointer);
      for (const fn of cleanup) fn();
    },
  };
}
