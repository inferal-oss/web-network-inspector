"use client";
import { createElement, forwardRef, useEffect, useRef } from "react";
import { createInspector } from "./index.js";

const setRef = (ref, value) => {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
};

/** Optional React integration. The core entry point never imports React. */
export const NetworkInspector = forwardRef(function NetworkInspector(
  {
    scope,
    store,
    filter,
    capture = true,
    open,
    stylesheet,
    nonce,
    onReady,
    ...containerProps
  },
  forwardedRef,
) {
  const mount = useRef(null);
  const instance = useRef(null);
  const latest = useRef({ open, onReady });
  latest.current = { open, onReady };
  useEffect(() => {
    const inspector = createInspector({
      scope: scope ?? mount.current.ownerDocument.defaultView,
      container: mount.current,
      store,
      filter,
      capture,
      open: latest.current.open ?? false,
      stylesheet,
      nonce,
    });
    instance.current = inspector;
    let cleanup;
    try {
      setRef(forwardedRef, inspector);
      cleanup = latest.current.onReady?.(inspector);
    } catch (error) {
      instance.current = null;
      try {
        setRef(forwardedRef, null);
      } finally {
        inspector.destroy();
      }
      throw error;
    }
    return () => {
      instance.current = null;
      try {
        if (typeof cleanup === "function") cleanup();
      } finally {
        try {
          setRef(forwardedRef, null);
        } finally {
          inspector.destroy();
        }
      }
    };
  }, [scope, store, filter, capture, stylesheet, nonce, forwardedRef]);
  useEffect(() => {
    if (open !== undefined) instance.current?.setOpen(open);
  }, [open]);
  return createElement("div", { ...containerProps, ref: mount });
});
