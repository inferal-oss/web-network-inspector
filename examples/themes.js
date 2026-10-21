// Shared by the shadow root and the details iframe. No global page styles.
export const palettes = {
  plum: {
    "--panel": "#fffdfd",
    "--paper": "#faf5ff",
    "--ink": "#312044",
    "--muted": "#705c80",
    "--line": "#dfd1ee",
    "--brand": "#7c3aed",
    "--brand-dark": "#6024b5",
    "--brand-soft": "#efe5ff",
    "--signal": "#a72d73",
  },
  dark: {
    "--openregard-color-scheme": "dark",
    "--panel": "#141c2b",
    "--paper": "#1c273b",
    "--ink": "#e7edf8",
    "--muted": "#b4c2d8",
    "--line": "#41516b",
    "--brand": "#a8bdff",
    "--brand-dark": "#c5d2ff",
    "--brand-soft": "#293856",
    "--signal": "#ffabc9",
    "--demo-error": "#ffb2bd",
    "--demo-blue": "#abcaff",
    "--demo-blue-wash": "#243853",
    "--demo-green": "#9be5c5",
    "--demo-green-wash": "#193e37",
    "--demo-amber": "#ffdc96",
    "--demo-amber-wash": "#44351b",
    "--demo-red": "#ffb2bd",
    "--demo-red-wash": "#4b2633",
    "--demo-pink": "#ffb6d1",
    "--demo-pink-wash": "#47263f",
    "--demo-violet": "#d5b9ff",
    "--demo-violet-wash": "#382d53",
  },
};
const rules = (theme, selector, declaration) =>
  [
    `:host([data-demo-effective="${theme}"])`,
    `:root[data-demo-effective="${theme}"]`,
  ]
    .map(
      (root) => `${root}${selector ? " " + selector : ""} { ${declaration} }`,
    )
    .join("\n");
export const themeStyles = [
  ...Object.entries(palettes).flatMap(([theme, tokens]) => [
    rules(
      theme,
      "",
      Object.entries(tokens)
        .map(([k, v]) => `${k}: ${v}`)
        .join(";"),
    ),
    rules(
      theme,
      ".network-bar",
      "border-top: 3px solid var(--brand); background: linear-gradient(110deg,var(--paper),var(--brand-soft))",
    ),
    rules(theme, ".network-popup", "border-radius: 18px"),
    rules(theme, ".network-bar button", "border-radius: 9px"),
  ]),
  rules("dark", "", "color-scheme: dark"),
  rules("dark", '.network-row[data-kind="message"]', "color: #9be5c5"),
  rules("dark", ".network-json-string", "color: #9be5c5"),
  rules("dark", ".network-json-number", "color: #abcaff"),
  rules("dark", ".network-json-boolean", "color: #d5b9ff"),
  rules("dark", ".network-html-preview", "background: var(--panel)"),
  rules("dark", ".hljs-comment", "color: #b4c2d8"),
  ...[
    [".hljs-quote", "#b4c2d8"],
    [".hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-meta", "#d5b9ff"],
    [".hljs-string, .hljs-regexp, .hljs-addition, .hljs-attr", "#9be5c5"],
    [".hljs-number, .hljs-symbol, .hljs-bullet, .hljs-variable", "#ffdc96"],
    [".hljs-title, .hljs-section, .hljs-built_in, .hljs-type", "#abcaff"],
    [
      ".hljs-name, .hljs-tag, .hljs-deletion, .hljs-selector-class, .hljs-selector-id",
      "#ffb6d1",
    ],
    [".hljs-attribute, .hljs-property", "#abcaff"],
  ].map(([selectors, color]) =>
    selectors
      .split(", ")
      .map((s) => rules("dark", s, `color: ${color}`))
      .join("\n"),
  ),
].join("\n");
