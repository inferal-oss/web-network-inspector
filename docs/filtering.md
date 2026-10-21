# Capture filters

Decide which network entries reach the inspector's retained history with a synchronous predicate. This is separate from the search and type controls, which only change what the view displays.

## Filter by hostname

```js
import { createInspector, byHostnames } from "web-network-inspector";

const inspector = createInspector({
  open: true,
  filter: byHostnames(["api.example.com", "ws.example.com"]),
});
```

Only those exact hostnames match, regardless of scheme or port. Hostnames are normalized for case, internationalized names, and a trailing DNS dot. To include subdomains, opt in explicitly:

```js
const filter = byHostnames(["example.com"], { includeSubdomains: true });
// Matches example.com and api.example.com.
// Does not match example.com.attacker.test or notexample.com.
```

## Write your own predicate

```js
const inspector = createInspector({
  filter: ({ hostname, method, url, kind }) =>
    hostname === "api.example.com" &&
    method === "GET" &&
    !new URL(url).pathname.startsWith("/private/"),
});
```

The predicate receives a frozen metadata object, with no body or headers:

| Field       | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `kind`      | `http`, `resource`, `socket`, or `message`                                    |
| `transport` | `fetch`, `XHR`, `WebSocket`, or the resource initiator type                   |
| `method`    | HTTP method, `GET` for resource timings, or null for WebSockets               |
| `url`       | The captured URL, normalized by the transport and bounded to 2,048 characters |
| `hostname`  | Parsed URL hostname, or null                                                  |
| `origin`    | Parsed URL origin including scheme and non-default port, or null              |
| `protocol`  | URL protocol such as `https:` or `wss:`, or null                              |
| `direction` | `in` or `out` for WebSocket messages, otherwise null                          |

Return exactly `true` to retain an entry. False, non-boolean results, thrown errors, and promises reject it. Predicates run synchronously; use already-available application state and keep them fast. Rejections do not cancel the actual request, socket, or message. Filtering happens before entries and body previews are retained; rejected entries do not trigger subscribers or consume the retention budget. It is not a response-content redaction API.

The predicate runs for HTTP requests, observed resources, WebSocket connections, and frames. Rejecting a socket connection also excludes its frames. Buffered resource timings are filtered too. Application events created with `recordEvent` remain available so they can explain user interactions independently of network capture.

## Compose filters

```js
import {
  allOf,
  anyOf,
  not,
  byHostnames,
  byOrigins,
  byMethods,
} from "web-network-inspector/filters";

const apiReads = allOf(
  byOrigins(["https://api.example.com", "https://api.example.com:8443"]),
  byMethods(["GET", "HEAD"]),
);
const filter = anyOf(apiReads, byOrigins(["wss://ws.example.com"]));
const excludeAnalytics = not(byHostnames(["analytics.example.com"]));
```

`byHostnames(values, options)`, `byOrigins(values)`, and `byMethods(values)` return predicates. Each accepts one string or an iterable of strings. An empty list matches nothing. Origins must have a supported HTTP/WebSocket scheme and no path, credentials, query, or fragment. `https://example.com` and `wss://example.com` are different origins. Methods match without case sensitivity.

`allOf(...filters)` requires every predicate to return true; `anyOf(...filters)` requires at least one. They short-circuit left to right. `not(filter)` negates a boolean result. Invalid results and exceptions propagate through composition and are rejected by the recorder. No arguments make `allOf()` match everything and `anyOf()` match nothing.

## Headless capture and shared views

Configure a shared store's filter when creating it:

```js
import {
  NetworkCapture,
  installNetworkCapture,
  byHostnames,
} from "web-network-inspector";

const store = new NetworkCapture({ filter: byHostnames(["api.example.com"]) });
const capture = installNetworkCapture(window, store);
// createInspector({ store, capture: false });
// capture.disconnect();
```

When passing `store` to `createInspector`, put its filter on `NetworkCapture`; supplying both `store` and `filter` to the view throws. The store owns the capture policy for all views. Without a filter, capture behavior is unchanged. For React, keep a predicate stable with module scope or `useMemo`; see the [React guide](react.md).
