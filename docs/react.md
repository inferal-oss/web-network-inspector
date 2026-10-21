# React component

Use the optional `web-network-inspector/react` entry point with React 18 or later. The core package does not import React, and its peer dependency is optional: ordinary JavaScript consumers do not need to install it.

## Mount the inspector

```jsx
import { NetworkInspector } from "web-network-inspector/react";

export function App() {
  return (
    <>
      <YourApplication />
      <NetworkInspector open className="application-inspector" />
    </>
  );
}
```

The component mounts one inspector after the browser commits it, and destroys it on unmount. It supports React Strict Mode's setup/cleanup cycle and produces an empty container during server rendering. In frameworks with Server Components, render it inside a client component. Only mount one capture owner per browser window.

Capture starts when the effect mounts. Requests made earlier, including initial rendering or earlier application effects, are not intercepted. Install headless capture before starting your application if you need that traffic, then pass its store and `capture={false}` to this view.

## Use the inspector API

A ref exposes the same API as `createInspector`. It is null before mounting and after cleanup:

```jsx
import { useRef } from "react";
import { NetworkInspector } from "web-network-inspector/react";

export function Example() {
  const inspector = useRef(null);
  return (
    <>
      <button
        onClick={() =>
          inspector.current?.recordEvent({
            type: "draft.saved",
            label: "Saved a draft",
            data: JSON.stringify({ revision: 3 }),
          })
        }
      >
        Save draft
      </button>
      <NetworkInspector
        ref={inspector}
        open
        onReady={(api) => {
          const item = api.addBarItem({ id: "status", label: "Connected" });
          return () => item.remove();
        }}
      />
    </>
  );
}
```

`onReady(api)` runs whenever an instance is created. Its optional returned function runs before that instance is destroyed. Changing `onReady` alone does not recreate the inspector; it supplies the callback for the next instance. Keep callback refs stable with `useCallback`, or use an object ref from `useRef`.

## Props and lifecycle

| Prop                  | Behavior                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `open`                | Optional boolean. Initial state and subsequent prop changes call `setOpen`; omitting it lets the inspector manage its own toggle. |
| `scope`               | Window to inspect; defaults to the rendered container's window.                                                                   |
| `capture`             | Defaults to true. False creates a view without installing transport wrappers.                                                     |
| `store`               | Optional shared `NetworkCapture`. Configure its filter on the store.                                                              |
| `filter`              | Predicate for an instance-owned store; do not combine with `store`.                                                               |
| `stylesheet`, `nonce` | Same stylesheet options as `createInspector`.                                                                                     |
| `renderDetails`       | Custom details renderer; receives the iframe context described in [request details](details.md).                                  |
| `onReady`             | Receives the created inspector; may return cleanup.                                                                               |
| `ref`                 | Object or stable callback ref receiving the inspector API.                                                                        |
| Other props           | Passed to the outer `div`, including `className`, `style`, `id`, and accessible attributes.                                       |

Changes to `scope`, `store`, `filter`, `capture`, `stylesheet`, `nonce`, `renderDetails`, or the ref identity destroy and recreate the instance. A recreated instance with no external store starts with a fresh history. Changing ordinary container props, `onReady`, or `open` does not recreate capture. Memoize functions and stores so normal parent renders do not reset it:

```jsx
import { useMemo } from "react";
import { byHostnames } from "web-network-inspector";
import { NetworkInspector } from "web-network-inspector/react";

export function DebugTools() {
  const filter = useMemo(() => byHostnames(["api.example.com"]), []);
  return <NetworkInspector filter={filter} open />;
}
```

The component owns destruction; avoid calling `destroy()` through its ref while it is still mounted. Use conditional rendering to remove it. A shared external store remains yours and is not cleared on unmount.

## Styling in React

The component's `className` belongs to the outer container. Target its inspector host to set variables through the Shadow DOM boundary:

```css
.application-inspector [data-web-network-inspector] {
  --brand: #7c3aed;
  --brand-dark: #6d28d9;
  --brand-soft: #ede9fe;
  --network-height: 55vh;
}
```

For a bundler, import the exported stylesheet as a public URL and pass it through `stylesheet`. For example, with a bundler that supports `?url`:

```jsx
import inspectorCSS from "web-network-inspector/style.css?url";

<NetworkInspector stylesheet={inspectorCSS} open />;
```

A plain global CSS import does not style Shadow DOM internals. See the [styling guide](styling.md) for overrides, custom controls, and replacing the base stylesheet, and the [API reference](api.md) for methods available through the ref.
