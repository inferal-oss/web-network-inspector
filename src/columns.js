const write = (node, value) => {
  if (node.textContent !== value) node.textContent = value;
};
const bytes = (value) =>
  value == null
    ? "unknown size"
    : value < 1024
      ? `${value} B`
      : `${(value / 1024).toFixed(1)} KiB`;
export function activityName(entry) {
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
export function hostPath(entry, { container, document }) {
  if (!container.firstChild) {
    for (const className of ["network-row-label", "network-row-host"]) {
      const node = document.createElement("span");
      node.className = className;
      container.append(node);
    }
  }
  write(container.firstChild, `#${entry.id} ${activityName(entry)}`);
  let host = "";
  try {
    if (entry.kind !== "event") host = new URL(entry.url).host;
  } catch {}
  write(container.lastChild, host);
  container.lastChild.hidden = !host;
}
export function httpCode(entry) {
  const value = entry.httpCode ?? entry.status;
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
export function status(entry, { container }) {
  const value = httpCode(entry);
  write(
    container,
    value == null
      ? String(entry.status ?? (entry.kind === "event" ? "Event" : ""))
      : value >= 400
        ? "HTTP error"
        : value >= 300
          ? "Redirect"
          : "Complete",
  );
}
export function code(entry, { container }) {
  write(container, String(httpCode(entry) ?? "—"));
}
export function size(entry, { container }) {
  write(
    container,
    bytes(entry.body?.size ?? entry.responseBody?.size ?? entry.transferSize),
  );
}
export function waterfall(entry, { container, document, timeline }) {
  container.classList.add?.("network-track");
  if (!container.firstChild) container.append(document.createElement("i"));
  const { start, end, now } = timeline,
    pos = timelinePosition(entry, start, end, now),
    bar = container.firstChild;
  bar.style.left = `${pos.left}%`;
  bar.style.width =
    entry.socketEvent || ["event", "message"].includes(entry.kind)
      ? "3px"
      : `max(3px, ${pos.width}%)`;
  container.title = `${(entry.start - start).toFixed(1)} ms after timeline start${entry.end != null ? ` · ${(entry.end - entry.start).toFixed(1)} ms` : ""}`;
}
export function activitySize(entry) {
  const value =
    entry.body?.size ?? entry.responseBody?.size ?? entry.transferSize;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
/** Ascending byte comparison. The table keeps unavailable sizes last in either direction. */
export function sizeSorter(left, right) {
  const a = activitySize(left),
    b = activitySize(right);
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a - b;
}
export const columnRenderers = Object.freeze({
  hostPath,
  status,
  code,
  size,
  waterfall,
});
export const defaultColumns = Object.freeze(
  [
    {
      id: "hostPath",
      label: "Request / event",
      render: hostPath,
      width: 320,
      minWidth: 130,
      className: "network-row-name",
    },
    {
      id: "status",
      label: "Status",
      render: status,
      width: 80,
      minWidth: 64,
      className: "network-row-status",
    },
    {
      id: "code",
      label: "HTTP code",
      render: code,
      width: 64,
      minWidth: 56,
      className: "network-row-code",
    },
    {
      id: "size",
      label: "Size",
      render: size,
      width: 72,
      minWidth: 56,
      className: "network-row-size",
      sort: sizeSorter,
    },
    {
      id: "waterfall",
      label: "Waterfall",
      render: waterfall,
      width: 160,
      minWidth: 100,
      className: "network-track",
      flex: true,
      live: true,
    },
  ].map(Object.freeze),
);
export function normalizeColumns(columns = defaultColumns) {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 24)
    throw new TypeError("columns must contain between 1 and 24 definitions.");
  const ids = new Set();
  const definitions = columns.map((column) => {
    if (
      !column ||
      typeof column.id !== "string" ||
      !column.id ||
      ids.has(column.id) ||
      typeof column.label !== "string" ||
      typeof column.render !== "function"
    )
      throw new TypeError(
        "Columns require unique string IDs, labels, and render functions.",
      );
    if (
      column.sort !== undefined &&
      column.sort !== false &&
      column.sort !== "size" &&
      typeof column.sort !== "function"
    )
      throw new TypeError(
        "Column sort must be false or a comparator function.",
      );
    if (column.hidden !== undefined && typeof column.hidden !== "boolean")
      throw new TypeError("Column hidden must be a boolean.");
    ids.add(column.id);
    const { width = 160, minWidth = 40, maxWidth = 2400 } = column;
    if (
      ![width, minWidth, maxWidth].every(Number.isFinite) ||
      minWidth < 24 ||
      maxWidth > 4000 ||
      maxWidth < minWidth ||
      width < minWidth ||
      width > maxWidth
    )
      throw new RangeError("Invalid column width bounds.");
    return {
      ...column,
      hidden: column.hidden ?? false,
      sort: column.sort === "size" ? sizeSorter : column.sort,
      width: Math.round(width),
      minWidth: Math.round(minWidth),
      maxWidth: Math.round(maxWidth),
    };
  });
  if (!definitions.some((column) => !column.hidden))
    throw new RangeError("At least one column must be visible.");
  return definitions;
}

export function setupColumnLayout({
  root,
  scope,
  store,
  columns,
  sortSize,
  onSort,
  onChange = () => {},
}) {
  const document = root.ownerDocument,
    header = root.getElementById("network-columns"),
    panel = root.getElementById("network-activity");
  let definitions = normalizeColumns(columns),
    drag = null,
    sorting = null;
  const visible = () => definitions.filter((column) => !column.hidden);
  const buttons = new Map();
  const boundButtons = new WeakSet();
  const states = new Map();
  function disposeCell(state) {
    const fn = state.cleanup;
    state.cleanup = null;
    try {
      fn?.();
    } catch {}
  }
  function disposeRow(row) {
    const state = states.get(row);
    if (state) for (const cell of state) disposeCell(cell);
    states.delete(row);
  }
  function widths() {
    panel.style.setProperty(
      "--network-columns",
      visible()
        .map((c) => (c.flex ? `minmax(${c.width}px,1fr)` : `${c.width}px`))
        .join(" "),
    );
    panel.style.setProperty(
      "--network-table-width",
      `${visible().reduce((n, c) => n + c.width, 24) + (visible().length - 1) * 8}px`,
    );
    for (let i = 0; i < visible().length; i++)
      header.children[i].lastChild.setAttribute(
        "aria-valuenow",
        String(visible()[i].width),
      );
  }
  function resize(column, width) {
    column.width = Math.max(
      column.minWidth,
      Math.min(column.maxWidth, Math.round(width)),
    );
    column.flex = false;
    widths();
    onChange();
  }
  function updateSort(next) {
    sorting = next;
    for (const column of visible()) {
      const button = buttons.get(column.id);
      if (!button) continue;
      const direction = sorting?.id === column.id ? sorting.direction : null;
      const size = column.sort === sizeSorter;
      const label = !direction
        ? `Sort by ${column.label.toLowerCase()}, ${size ? "largest first" : "descending"}`
        : `${column.label}: ${direction === "descending" ? (size ? "largest first" : "descending") : size ? "smallest first" : "ascending"}. ${direction === "descending" ? (size ? "Sort smallest first" : "Sort ascending") : "Restore time order"}`;
      button.textContent = `${column.label} ${direction === "descending" ? "↓" : direction === "ascending" ? "↑" : "↕"}`;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(Boolean(direction)));
      button.title = label;
    }
  }
  function headings() {
    header.replaceChildren();
    buttons.clear();
    for (const column of visible()) {
      const cell = document.createElement("span");
      cell.className = "network-column-heading";
      if (typeof column.sort === "function") {
        const button =
          column.id === "size" ? sortSize : document.createElement("button");
        button.type = "button";
        button.className = "network-sort";
        button.dataset.sortColumn = column.id;
        if (!boundButtons.has(button)) {
          button.addEventListener("click", () => {
            const current = definitions.find(
              (c) => c.id === button.dataset.sortColumn,
            );
            if (typeof current?.sort === "function") onSort(current);
          });
          boundButtons.add(button);
        }
        buttons.set(column.id, button);
        cell.append(button);
      } else cell.textContent = column.label;
      const grip = document.createElement("span");
      grip.className = "network-column-resize";
      grip.setAttribute("role", "separator");
      grip.setAttribute("tabindex", "0");
      grip.setAttribute("aria-orientation", "vertical");
      grip.setAttribute("aria-label", `Resize ${column.label} column`);
      grip.setAttribute("aria-valuemin", String(column.minWidth));
      grip.setAttribute("aria-valuemax", String(column.maxWidth));
      grip.title =
        "Drag to resize. Use left and right arrow keys when focused.";
      grip.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        const width = cell.getBoundingClientRect().width || column.width;
        drag = { column, x: event.clientX, width };
        grip.setPointerCapture?.(event.pointerId);
      });
      grip.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation?.();
        const width = cell.getBoundingClientRect().width || column.width;
        resize(
          column,
          event.key === "Home"
            ? column.minWidth
            : event.key === "End"
              ? column.maxWidth
              : width +
                (event.key === "ArrowLeft" ? -1 : 1) *
                  (event.shiftKey ? 50 : 10),
        );
      });
      cell.append(grip);
      header.append(cell);
    }
    widths();
    updateSort(sorting);
  }
  const move = (event) => {
    if (drag) resize(drag.column, drag.width + event.clientX - drag.x);
  };
  const stop = () => {
    drag = null;
  };
  scope.addEventListener("pointermove", move);
  scope.addEventListener("pointerup", stop);
  scope.addEventListener("pointercancel", stop);
  scope.addEventListener("blur", stop);
  headings();
  return {
    updateSort,
    getColumns: () => definitions.map((c) => ({ ...c })),
    setColumns(next) {
      const valid = normalizeColumns(next);
      for (const row of states.keys()) {
        disposeRow(row);
        row.replaceChildren();
      }
      definitions = valid;
      drag = null;
      headings();
    },
    renderRow(row, entry, timeline) {
      let state = states.get(row);
      if (!state) {
        state = visible().map((column) => {
          const container = document.createElement("span");
          container.className = `network-cell ${column.className || ""}`;
          container.dataset.column = column.id;
          row.append(container);
          return { container, revision: null, cleanup: null, column };
        });
        states.set(row, state);
      }
      for (const cell of state) {
        const { column, container } = cell;
        if (!column.live && cell.revision === entry.revision) continue;
        cell.revision = entry.revision;
        disposeCell(cell);
        if (!Object.values(columnRenderers).includes(column.render))
          container.replaceChildren();
        try {
          const result = column.render(entry, {
            container,
            document,
            timeline,
            store,
          });
          if (typeof result === "function") cell.cleanup = result;
          else if (result?.nodeType) container.replaceChildren(result);
          else if (result && typeof result.then === "function") {
            void Promise.resolve(result).catch(() => {});
            throw new TypeError("Column renderers must be synchronous.");
          } else if (result != null) write(container, String(result));
        } catch (error) {
          write(container, "Renderer error");
          container.title = error.message;
        }
      }
    },
    releaseExpired() {
      for (const [row, cells] of states)
        if (!store.byId.has(Number(row.dataset.entryId)))
          for (const cell of cells)
            if (!Object.values(columnRenderers).includes(cell.column.render)) {
              disposeCell(cell);
              write(cell.container, "Expired");
            }
    },
    disposeRow,
    destroy() {
      for (const row of states.keys()) disposeRow(row);
      scope.removeEventListener("pointermove", move);
      scope.removeEventListener("pointerup", stop);
      scope.removeEventListener("pointercancel", stop);
      scope.removeEventListener("blur", stop);
    },
  };
}
