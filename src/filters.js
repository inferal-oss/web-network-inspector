/** Predicate factories for deciding which network entries enter retained history. */
const list = (values) =>
  typeof values === "string" ? [values] : Array.from(values);
function hostname(value) {
  if (typeof value !== "string" || /[\s/@?#]/.test(value))
    throw new TypeError("Expected a hostname without a scheme, path, or port.");
  if (value.startsWith("[") ? !/^\[[^\]]+\]$/.test(value) : value.includes(":"))
    throw new TypeError("Expected a hostname without a port.");
  const url = new URL(`http://${value}`);
  if (url.port || !url.hostname)
    throw new TypeError("Expected a hostname without a port.");
  return url.hostname.toLowerCase().replace(/\.$/, "");
}
export function byHostnames(values, { includeSubdomains = false } = {}) {
  if (typeof includeSubdomains !== "boolean")
    throw new TypeError("includeSubdomains must be a boolean.");
  const names = new Set(list(values).map(hostname));
  return ({ hostname: value }) => {
    if (!value) return false;
    const candidate = value.toLowerCase().replace(/\.$/, "");
    return (
      names.has(candidate) ||
      (includeSubdomains &&
        [...names].some((name) => candidate.endsWith("." + name)))
    );
  };
}
export function byOrigins(values) {
  const origins = new Set(
    list(values).map((value) => {
      const url = new URL(value);
      if (
        !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new TypeError(
          "Expected an HTTP or WebSocket origin without a path or credentials.",
        );
      return url.origin;
    }),
  );
  return ({ origin }) => origins.has(origin);
}
export function byMethods(values) {
  const methods = new Set(
    list(values).map((value) => {
      if (
        typeof value !== "string" ||
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(value)
      )
        throw new TypeError("Expected an HTTP method.");
      return value.toUpperCase();
    }),
  );
  return ({ method }) =>
    typeof method === "string" && methods.has(method.toUpperCase());
}
function predicate(value) {
  if (typeof value !== "function")
    throw new TypeError("Expected a filter function.");
  return value;
}
function result(filter, entry) {
  const value = filter(entry);
  if (value && typeof value.then === "function")
    void Promise.resolve(value).catch(() => {});
  if (typeof value !== "boolean")
    throw new TypeError("Filters must return a boolean synchronously.");
  return value;
}
export function allOf(...filters) {
  filters.forEach(predicate);
  return (entry) => filters.every((filter) => result(filter, entry));
}
export function anyOf(...filters) {
  filters.forEach(predicate);
  return (entry) => filters.some((filter) => result(filter, entry));
}
export function not(filter) {
  predicate(filter);
  return (entry) => !result(filter, entry);
}
