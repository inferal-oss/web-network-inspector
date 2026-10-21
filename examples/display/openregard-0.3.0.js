"use strict";
var OpenRegardDisplay = (() => {
  var E = Object.defineProperty;
  var M = Object.getOwnPropertyDescriptor;
  var K = Object.getOwnPropertyNames;
  var N = Object.prototype.hasOwnProperty;
  var W = (o, e) => {
      for (var n in e) E(o, n, { get: e[n], enumerable: !0 });
    },
    T = (o, e, n, l) => {
      if ((e && typeof e == "object") || typeof e == "function")
        for (let t of K(e))
          !N.call(o, t) &&
            t !== n &&
            E(o, t, {
              get: () => e[t],
              enumerable: !(l = M(e, t)) || l.enumerable,
            });
      return o;
    };
  var I = (o) => T(E({}, "__esModule", { value: !0 }), o);
  var V = {};
  W(V, {
    createDisplay: () => D,
    mountDisplayWidget: () => L,
    validateDisplayConfig: () => k,
  });
  function k(o) {
    let e = (t) => {
      throw new TypeError(`Open Regard: ${t}`);
    };
    (!o || o.version !== 1) && e("config.version must be 1");
    for (let t of ["storageKey", "controlLabel"])
      (typeof o[t] != "string" || !o[t].trim()) &&
        e(`${t} must be a nonempty string`);
    (o.attribute !== void 0 &&
      !/^data-[a-z][a-z0-9-]*$/.test(o.attribute) &&
      e("attribute must be a lowercase data-* attribute"),
      (!Array.isArray(o.profiles) || !o.profiles.length) &&
        e("profiles must not be empty"));
    let n = new Set(),
      l = o.profiles.map((t, f) => {
        ((!t ||
          typeof t.id != "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(t.id)) &&
          e(
            `profiles[${f}].id must be 1\u201364 ASCII letters, digits, underscores or hyphens, starting with a letter or digit`,
          ),
          n.has(t.id) && e(`duplicate profile id "${t.id}"`),
          n.add(t.id),
          (typeof t.label != "string" || !t.label.trim()) &&
            e(`profile "${t.id}" needs a label`),
          t.description !== void 0 &&
            typeof t.description != "string" &&
            e(`profile "${t.id}" description must be a string`),
          t.tokens !== void 0 &&
            (!t.tokens ||
              typeof t.tokens != "object" ||
              Array.isArray(t.tokens)) &&
            e(`profile "${t.id}" tokens must be an object`));
        for (let [i, s] of Object.entries(t.tokens ?? {}))
          (!/^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(i) ||
            typeof s != "string" ||
            !s.trim()) &&
            e(`profile "${t.id}" has invalid token "${i}"`);
        return Object.freeze({
          ...t,
          tokens: t.tokens ? Object.freeze({ ...t.tokens }) : void 0,
        });
      });
    return (
      n.has(o.defaultProfile) ||
        e(`defaultProfile "${o.defaultProfile}" does not exist`),
      Object.freeze({
        ...o,
        attribute: o.attribute ?? "data-regard-profile",
        profiles: Object.freeze(l),
      })
    );
  }
  var C = new WeakMap(),
    A = "openregard:profile";
  function D(o) {
    let e = k(o),
      n = e.attribute,
      l = new Map(e.profiles.map((r) => [r.id, r])),
      t = (r) => (l.has(r ?? "") ? r : e.defaultProfile),
      f = e.defaultProfile,
      i = new Set(),
      s,
      m = 0,
      w = () => {
        for (let r of [...i]) r();
      },
      p = () => {};
    function y(r) {
      let g = t(r),
        d = g !== f;
      ((f = g), p(), d && w());
    }
    function v() {
      if (!s) return;
      let r = s.root.ownerDocument.createEvent("CustomEvent");
      (r.initCustomEvent(A, !1, !1, {
        storageKey: e.storageKey,
        id: f,
        source: a,
      }),
        s.win.dispatchEvent(r));
    }
    let a = {
      config: e,
      getSnapshot: () => f,
      getServerSnapshot: () => e.defaultProfile,
      subscribe(r) {
        return (
          i.add(r),
          () => {
            i.delete(r);
          }
        );
      },
      setProfile(r) {
        if (!l.has(r))
          throw new RangeError(`Open Regard: unknown profile "${r}"`);
        y(r);
        try {
          s?.storage?.setItem(e.storageKey, f);
        } catch {}
        v();
      },
      reset() {
        y(e.defaultProfile);
        try {
          s?.storage?.removeItem(e.storageKey);
        } catch {}
        v();
      },
      start(r = {}) {
        let g = r.window ?? (typeof window < "u" ? window : void 0),
          d = r.root ?? s?.root ?? g?.document.documentElement;
        if (!g || !d)
          throw new Error(
            "Open Regard: start() requires a browser window and root",
          );
        if (d.ownerDocument.defaultView !== g)
          throw new Error(
            "Open Regard: root and window must belong to the same document",
          );
        if (s && (s.root !== d || s.win !== g))
          throw new Error(
            "Open Regard: controller is already started on another root",
          );
        if (!s) {
          let h = C.get(d) ?? new Map();
          if (h.has(n))
            throw new Error(
              `Open Regard: ${n} already has a controller; share that controller between widgets`,
            );
          (C.set(d, h), h.set(n, a));
          let P = d.getAttribute(n),
            j = [
              ...new Set(
                e.profiles.flatMap((c) => Object.keys(c.tokens ?? {})),
              ),
            ].map((c) => [
              c,
              d.style.getPropertyValue(c),
              d.style.getPropertyPriority(c),
            ]),
            S = () => {
              for (let [c, u, z] of j)
                u ? d.style.setProperty(c, u, z) : d.style.removeProperty(c);
            };
          p = () => {
            (S(), d.setAttribute(n, f));
            for (let [c, u] of Object.entries(l.get(f).tokens ?? {}))
              d.style.setProperty(c, u);
          };
          let b,
            x = f;
          try {
            ((b = g.localStorage), (x = b.getItem(e.storageKey)));
          } catch {}
          let O = (c) => {
              !b ||
                c.storageArea !== b ||
                (c.key !== e.storageKey && c.key !== null) ||
                y(c.key === null ? null : c.newValue);
            },
            R = (c) => {
              let u = c.detail;
              u?.source !== a && u?.storageKey === e.storageKey && y(u.id);
            };
          (g.addEventListener("storage", O),
            g.addEventListener(A, R),
            (s = {
              root: d,
              win: g,
              storage: b,
              cleanup() {
                (g.removeEventListener("storage", O),
                  g.removeEventListener(A, R),
                  S(),
                  P === null ? d.removeAttribute(n) : d.setAttribute(n, P),
                  h.delete(n),
                  (p = () => {}));
              },
            }),
            y(x));
        }
        m++;
        let $ = !1;
        return () => {
          $ || (($ = !0), --m === 0 && (s.cleanup(), (s = void 0)));
        };
      },
    };
    return a;
  }
  var Z =
    "M2 12 Q12 0 22 12 Q12 24 2 12 Z M16 12 A4 4 0 1 1 8 12 A4 4 0 1 1 16 12";
  function H(o) {
    return o.config.profiles
      .map((e) => `${e.label}${e.description ? `: ${e.description}` : ""}`)
      .join(". ");
  }
  function L(o, e, n = {}) {
    let l = o.ownerDocument,
      t = l.createElement("label");
    if (((t.className = "openregard"), n.icon !== !1)) {
      let a =
        typeof n.icon == "function"
          ? n.icon(l)
          : l.createElementNS("http://www.w3.org/2000/svg", "svg");
      if (typeof n.icon != "function") {
        a.setAttribute("viewBox", "0 0 24 24");
        let r = l.createElementNS("http://www.w3.org/2000/svg", "path");
        (r.setAttribute("d", Z),
          r.setAttribute("fill", "none"),
          r.setAttribute("stroke", "currentColor"),
          a.append(r));
      }
      (a.setAttribute("aria-hidden", "true"),
        a.setAttribute("focusable", "false"),
        a.classList.add("openregard-icon"),
        t.append(a));
    }
    let f = l.createElement("span");
    ((f.className = "openregard-label"),
      (f.textContent = e.config.controlLabel));
    let i = l.createElement("select");
    ((i.className = "openregard-select"),
      i.setAttribute("aria-label", e.config.controlLabel));
    for (let a of e.config.profiles) {
      let r = l.createElement("option");
      ((r.value = a.id), (r.textContent = a.label), i.append(r));
    }
    let s = l.createElement("span");
    s.className = "openregard-description";
    let m = () => {
        i.value = e.getSnapshot();
        let a = e.config.profiles.find((r) => r.id === i.value);
        ((s.textContent = `${a.label}${a.description ? ` \u2014 ${a.description}` : ""}`),
          a.description
            ? i.setAttribute("aria-description", a.description)
            : i.removeAttribute("aria-description"),
          (i.title = H(e)));
      },
      w = () => e.setProfile(i.value);
    (i.addEventListener("change", w), t.append(f, i));
    let p = l.createElement("div");
    ((p.className = `openregard-widget ${n.className ?? ""}`.trim()),
      p.append(t, s));
    let y = e.start({ window: l.defaultView }),
      v = e.subscribe(m);
    return (
      m(),
      o.append(p),
      {
        element: p,
        select: i,
        destroy() {
          (v(), i.removeEventListener("change", w), p.remove(), y());
        },
      }
    );
  }
  return I(V);
})();
