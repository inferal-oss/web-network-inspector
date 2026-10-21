import { restoreViewState } from "./view-preferences.js";
import {
  activityName as name,
  activitySize,
  sizeSorter,
  setupColumnLayout,
} from "./columns.js";
export { timelinePosition, activitySize } from "./columns.js";
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
export function sortActivity(entries, order = "time") {
  const time = (a, b) => a.start - b.start || a.id - b.id;
  if (!order || order === "time") return [...entries].sort(time);
  const compare = typeof order === "string" ? sizeSorter : order.compare;
  const direction =
    typeof order === "string"
      ? order === "largest"
        ? "descending"
        : "ascending"
      : order.direction;
  return [...entries].sort((a, b) => {
    // Keep missing byte counts last when using the built-in sorter.
    if (
      compare === sizeSorter &&
      (activitySize(a) === null || activitySize(b) === null)
    )
      return sizeSorter(a, b) || time(a, b);
    const value = compare(a, b);
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new TypeError("Sort comparator must return a finite number.");
    return value * (direction === "descending" ? -1 : 1) || time(a, b);
  });
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
  const previousLoads = get("network-previous");
  const catalog = new Map(
    (options.columnCatalog ?? options.columns ?? []).map((column) => [
      column.id,
      column,
    ]),
  );
  const viewListeners = new Set();
  function notifyView() {
    for (const listener of viewListeners) {
      try {
        listener(getViewState());
      } catch {}
    }
  }
  function getViewState() {
    const current = columnLayout.getColumns();
    const known = new Set(current.map((column) => column.id));
    const all = [
      ...current,
      ...[...catalog.values()]
        .filter((column) => !known.has(column.id))
        .map((column) => ({ ...column, hidden: true })),
    ];
    return {
      version: 1,
      columns: all.map(({ id, width, flex, hidden, sort }) => ({
        id,
        width,
        flex: Boolean(flex),
        hidden: Boolean(hidden),
        sortable: typeof sort === "function",
      })),
      sorting: sorting
        ? { id: sorting.id, direction: sorting.direction }
        : null,
      includePreviousPageLoads: previousLoads.checked,
    };
  }
  const columnLayout = setupColumnLayout({
    root,
    scope,
    store,
    columns: options.columns,
    sortSize,
    onSort: sortColumn,
    onChange: notifyView,
  });
  cleanup.push(() => columnLayout.destroy());
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
    sorting = options.initialView?.sorting ?? null,
    sortError = "";
  let view = null,
    frozen = false,
    navigation = null;
  let pointerOverList = false,
    listFocused = false,
    pointerPressed = false,
    releasePointer = null;
  previousLoads.checked = options.initialView?.includePreviousPageLoads ?? true;
  if (sorting) follow.checked = false;
  renderSortControl();
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
    sorting = null;
    sortError = "";
    renderSortControl();
    detailRevision = "";
    render();
    notifyView();
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
    columnLayout.updateSort(sorting);
  }
  function sortColumn(column) {
    sorting =
      sorting?.id !== column.id
        ? { id: column.id, compare: column.sort, direction: "descending" }
        : sorting.direction === "descending"
          ? { ...sorting, direction: "ascending" }
          : null;
    sortError = "";
    if (sorting) follow.checked = false;
    resetView();
    renderSortControl();
    dirty = true;
    render();
    list.scrollTop = 0;
    notifyView();
  }
  listen(follow, "change", () => {
    if (follow.checked) {
      resetView();
      sorting = null;
      sortError = "";
      renderSortControl();
    } else freezeView();
    dirty = true;
    render();
    notifyView();
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
  listen(older, "click", () => navigate(!sorting ? "before" : "after"));
  listen(newer, "click", () => navigate(!sorting ? "after" : "before"));
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
    sorting = null;
    sortError = "";
    resetView();
    renderSortControl();
    dirty = true;
    render();
    detail.scrollTop = 0;
    notifyView();
  });
  function setIncludePreviousPageLoads(value) {
    if (typeof value !== "boolean")
      throw new TypeError("includePreviousPageLoads must be a boolean.");
    previousLoads.checked = value;
    if (!value && store.byId.get(selected)?.restored) {
      selected = null;
      detailRevision = "";
    }
    connection.value = "";
    resetView();
    dirty = true;
    render();
    notifyView();
  }
  listen(previousLoads, "change", () =>
    setIncludePreviousPageLoads(previousLoads.checked),
  );
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
        .filter(
          (e) =>
            (!e.restored || previousLoads.checked) &&
            (e.kind === "socket" || e.kind === "message"),
        )
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
      (!entry.restored || previousLoads.checked) &&
      (!connection.value ||
        String(entry.connection ?? entry.id) === connection.value) &&
      (!query ||
        `${name(entry)} ${entry.url || ""} ${entry.status || ""} ${entry.correlationId || ""} ${entry.eventType || ""}`
          .toLowerCase()
          .includes(query));
    let filtered;
    try {
      filtered = sortActivity(
        store.entries.filter(
          (entry) =>
            (!filter.value || entry.kind === filter.value) && matches(entry),
        ),
        sorting,
      );
    } catch (error) {
      sorting = null;
      sortError = `Sort failed: ${String(error?.message ?? error).slice(0, 200)}`;
      renderSortControl();
      notifyView();
      filtered = sortActivity(
        store.entries.filter(
          (entry) =>
            (!filter.value || entry.kind === filter.value) && matches(entry),
        ),
      );
    }
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
    let first = !sorting ? Math.max(0, filtered.length - 200) : 0,
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
          columnLayout.disposeRow(row);
          row.remove();
          rows.delete(id);
        }
      // Hold only IDs and the timeline scale. Expired payloads stay subject to capture limits.
      view = { ids: visible.map((e) => e.id), start, end, fence: store.serial };
    }
    ({ first, stop } = bounds(view.ids));
    text(
      get("network-range"),
      start < 0 ? "" : `${ms(start)} → ${ms(end)} since page load`,
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
    get("network-recording").textContent = store.paused
      ? "Paused"
      : "Recording";
    get("network-recording").dataset.paused = String(store.paused);
    summary.textContent = `${filtered.length} matching · ${bytes(store.bytes)} previews · ${store.expired} entries expired · ${store.expiredPreviews} previews expired · ${browsingStatus}${storageStatus}${sortError ? ` · ${sortError}` : ""}`;
    latest.hidden = !(frozen || browsing());
    text(latest, `${newCount} new · Jump to latest`);
    older.disabled = !sorting ? first === 0 : stop === filtered.length;
    newer.disabled = !sorting ? stop === filtered.length : first === 0;
    older.textContent = !sorting ? "Older" : "Next";
    newer.textContent = !sorting ? "Newer" : "Previous";
    if (!frozen) list.querySelector(".network-empty")?.remove();
    let previous = null;
    for (const entry of visible) {
      let row = rows.get(entry.id);
      if (!row) {
        row = element("div", "network-row");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.dataset.kind = entry.kind;
        row.dataset.entryId = String(entry.id);
        const id = entry.id;
        listen(row, "click", (event) => {
          if (
            !event.target.closest?.(
              "button,input,select,textarea,a,[contenteditable]",
            )
          )
            select(id);
        });
        listen(row, "keydown", (event) => {
          if (event.target === row && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            select(id);
          }
        });
        rows.set(id, row);
      }
      if (row.previousElementSibling !== previous || row.parentElement !== list)
        list.insertBefore(
          row,
          previous ? previous.nextSibling : list.firstChild,
        );
      previous = row;
      const label = name(entry);
      row.setAttribute("aria-label", `#${entry.id} ${label}`);
      row.title = entry.url ? `${label}\n${entry.url}` : label;
      columnLayout.renderRow(row, entry, { start, end, now });
    }
    columnLayout.releaseExpired();
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
  function replaceColumns(columns) {
    columnLayout.setColumns(columns);
    sorting = null;
    sortError = "";
    renderSortControl();
    for (const row of rows.values()) row.remove();
    rows.clear();
    resetView();
    dirty = true;
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
    getColumns: columnLayout.getColumns,
    setDetailsRenderer: detailView.setRenderer,
    getViewState,
    getIncludePreviousPageLoads: () => previousLoads.checked,
    setIncludePreviousPageLoads,
    subscribeView(listener) {
      if (typeof listener !== "function")
        throw new TypeError("View listener must be a function.");
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    setViewState(snapshot) {
      const restored = restoreViewState(
        [...catalog.values()],
        snapshot,
        options.initialView?.includePreviousPageLoads ?? true,
      );
      replaceColumns(restored.columns);
      sorting = restored.sorting;
      sortError = "";
      previousLoads.checked = restored.includePreviousPageLoads;
      if (!previousLoads.checked && store.byId.get(selected)?.restored) {
        selected = null;
        detailRevision = "";
      }
      follow.checked = !sorting;
      renderSortControl();
      resetView();
      dirty = true;
      render();
      notifyView();
    },
    setColumns(columns) {
      // Validate first; an invalid replacement must not change the catalog.
      const previous = columnLayout.getColumns();
      replaceColumns(columns);
      for (const column of previous)
        if (catalog.has(column.id))
          catalog.set(column.id, {
            ...catalog.get(column.id),
            width: column.width,
            flex: column.flex,
          });
      for (const column of columnLayout.getColumns())
        catalog.set(column.id, column);
      const current = new Set(
        columnLayout.getColumns().map((column) => column.id),
      );
      for (const id of catalog.keys())
        if (catalog.size > 24 && !current.has(id)) catalog.delete(id);
      dirty = true;
      render();
      notifyView();
    },
    destroy() {
      clearInterval(timer);
      clearInterval(counterTimer);
      clearTimeout(releasePointer);
      viewListeners.clear();
      for (const fn of cleanup) fn();
    },
  };
}
