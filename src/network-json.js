import { previewText } from "./network-capture.js";

class JsonNumber {
  constructor(source) {
    this.source = source;
  }
}
class JsonPartial {
  constructor(source, type) {
    this.source = source;
    this.type = type;
  }
}
const numberBase = "-?(?:0|[1-9]\\d*)";
const jsonNumber = new RegExp(`^${numberBase}(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$`);
const numberPrefix = new RegExp(
  `^(?:-|${numberBase}\\.|${numberBase}(?:\\.\\d+)?[eE][+-]?)$`,
);

// Read a JSON prefix without inventing closing tokens or missing values. This
// parser is iterative so a deeply nested retained prefix cannot overflow the stack.
function jsonPrefix(text) {
  let position = 0,
    value,
    hasRoot = false;
  const stack = [],
    incomplete = new WeakMap();
  const whitespace = (char) =>
    char === " " || char === "\t" || char === "\r" || char === "\n";
  function string() {
    const start = position++;
    while (position < text.length) {
      const char = text[position++];
      if (char === '"')
        return { value: JSON.parse(text.slice(start, position)) };
      if (char.charCodeAt(0) < 32) throw new Error("Invalid JSON string");
      if (char === "\\") {
        if (position === text.length) break;
        const escape = text[position++];
        if (escape === "u") {
          for (let digit = 0; digit < 4; digit++) {
            if (position === text.length)
              return {
                partial: true,
                value: new JsonPartial(text.slice(start), "string"),
              };
            if (!/[0-9a-f]/i.test(text[position++]))
              throw new Error("Invalid Unicode escape");
          }
        } else if (!'"\\/bfnrt'.includes(escape))
          throw new Error("Invalid JSON escape");
      }
    }
    return {
      partial: true,
      value: new JsonPartial(text.slice(start), "string"),
    };
  }
  function attach(item) {
    const frame = stack.at(-1);
    if (!frame) {
      value = item;
      hasRoot = true;
    } else if (frame.array) {
      frame.value.push(item);
      frame.state = "comma";
    } else {
      frame.value[frame.key] = item;
      frame.key = null;
      frame.state = "comma";
    }
  }
  function readValue() {
    const char = text[position];
    if (char === "{" || char === "[") {
      const array = char === "[",
        item = array ? [] : Object.create(null);
      position++;
      attach(item);
      stack.push({
        value: item,
        array,
        state: array ? "first" : "firstKey",
        key: null,
      });
      return;
    }
    if (char === '"') {
      attach(string().value);
      return;
    }
    const start = position;
    while (
      position < text.length &&
      !whitespace(text[position]) &&
      !",]}".includes(text[position])
    )
      position++;
    const token = text.slice(start, position),
      atEnd = position === text.length;
    if (!token) throw new Error("Missing JSON value");
    if (["true", "false", "null"].includes(token)) {
      attach(JSON.parse(token));
      return;
    }
    if (
      atEnd &&
      ["true", "false", "null"].some((literal) => literal.startsWith(token))
    ) {
      attach(new JsonPartial(token, "literal"));
      return;
    }
    if (jsonNumber.test(token)) {
      attach(atEnd ? new JsonPartial(token, "number") : new JsonNumber(token));
      return;
    }
    if (atEnd && numberPrefix.test(token)) {
      attach(new JsonPartial(token, "number"));
      return;
    }
    throw new Error("Invalid JSON token");
  }
  try {
    while (position < text.length) {
      if (whitespace(text[position])) {
        position++;
        continue;
      }
      const frame = stack.at(-1),
        char = text[position];
      if (!frame) {
        if (hasRoot) throw new Error("Unexpected JSON suffix");
        readValue();
        continue;
      }
      if (frame.array) {
        if (
          (frame.state === "first" && char === "]") ||
          (frame.state === "comma" && char === "]")
        ) {
          position++;
          stack.pop();
          continue;
        }
        if (frame.state === "comma") {
          if (char !== ",") throw new Error("Missing array separator");
          position++;
          frame.state = "value";
          continue;
        }
        readValue();
        continue;
      }
      if (
        (frame.state === "firstKey" && char === "}") ||
        (frame.state === "comma" && char === "}")
      ) {
        position++;
        stack.pop();
        continue;
      }
      if (frame.state === "comma") {
        if (char !== ",") throw new Error("Missing object separator");
        position++;
        frame.state = "key";
        continue;
      }
      if (frame.state === "firstKey" || frame.state === "key") {
        if (char !== '"') throw new Error("Missing JSON key");
        const key = string();
        if (key.partial) {
          frame.tail = `${key.value.source} … key cut off`;
          break;
        }
        frame.key = key.value;
        frame.state = "colon";
        continue;
      }
      if (frame.state === "colon") {
        if (char !== ":") throw new Error("Missing key separator");
        position++;
        frame.state = "value";
        continue;
      }
      readValue();
    }
    if (!hasRoot) return null;
    for (const frame of stack)
      incomplete.set(
        frame.value,
        frame.tail ??
          (frame.key !== null
            ? `${JSON.stringify(frame.key)}${frame.state === "value" ? ":" : ""} … not captured`
            : "… Preview ends here"),
      );
    return { value, incomplete };
  } catch {
    return null;
  }
}

/** Render only the retained preview. Nested collections load on expansion. */
export function jsonBodyPreview(preview, document = globalThis.document) {
  if (!preview?.text || preview.expired || preview.note) return null;
  let value,
    lossy = false,
    incomplete = new WeakMap();
  if (preview.truncated) {
    const parsed = jsonPrefix(previewText(preview));
    if (!parsed) return null;
    value = parsed.value;
    incomplete = parsed.incomplete;
  } else
    try {
      value = JSON.parse(previewText(preview), (_key, value, context) => {
        if (typeof value !== "number") return value;
        // Modern parsers expose the original token, including large integers.
        if (context?.source) return new JsonNumber(context.source);
        if (
          !Number.isFinite(value) ||
          (Number.isInteger(value) && !Number.isSafeInteger(value))
        )
          lossy = true;
        return value;
      });
    } catch {
      return null;
    }
  if (lossy) return null;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function node(value, key = null, index = false) {
    const collection =
      value !== null &&
      typeof value === "object" &&
      !(value instanceof JsonNumber) &&
      !(value instanceof JsonPartial);
    const row = make(
      collection ? "details" : "div",
      collection ? "network-json-branch" : "network-json-leaf",
    );
    const heading = collection ? make("summary") : row;
    if (key !== null)
      heading.append(
        make(
          "span",
          index ? "network-json-index" : "network-json-key",
          `${index ? key : JSON.stringify(key)}: `,
        ),
      );
    if (!collection) {
      if (value instanceof JsonPartial) {
        heading.append(
          make(
            "span",
            "network-json-partial",
            `${value.source} … [${value.type} cut off]`,
          ),
        );
        return row;
      }
      const type =
        value instanceof JsonNumber
          ? "number"
          : value === null
            ? "null"
            : typeof value;
      heading.append(
        make(
          "span",
          `network-json-${type}`,
          value instanceof JsonNumber
            ? value.source
            : Object.is(value, -0)
              ? "-0"
              : JSON.stringify(value),
        ),
      );
      return row;
    }
    const array = Array.isArray(value),
      keys = Object.keys(value),
      count = keys.length,
      partial = incomplete.has(value);
    heading.append(
      make(
        "span",
        "network-json-count",
        array
          ? `[ ${count}${partial ? " captured" : ""} item${count === 1 ? "" : "s"}${partial ? " · incomplete" : ""} ]`
          : `{ ${count}${partial ? " captured" : ""} propert${count === 1 ? "y" : "ies"}${partial ? " · incomplete" : ""} }`,
      ),
    );
    const children = make("div", "network-json-children");
    let loaded = 0,
      initialized = false,
      tailAdded = false;
    const more = make("button", "text-button network-json-more");
    more.type = "button";
    function loadMore() {
      initialized = true;
      more.remove();
      const stop = Math.min(count, loaded + 100);
      while (loaded < stop) {
        const key = keys[loaded++];
        children.append(node(value[key], key, array));
      }
      if (loaded < count) {
        more.textContent = `Show next ${Math.min(100, count - loaded)} · ${count - loaded} remaining`;
        children.append(more);
      } else if (partial && !tailAdded) {
        children.append(make("div", "network-json-end", incomplete.get(value)));
        tailAdded = true;
      }
    }
    more.addEventListener("click", loadMore);
    row.addEventListener("toggle", () => {
      if (row.open && !initialized) loadMore();
    });
    row.append(heading, children);
    if (key === null) {
      row.open = true;
      loadMore();
    }
    return row;
  }
  const tree = make("div", "network-json-tree");
  tree.append(node(value));
  return tree;
}
