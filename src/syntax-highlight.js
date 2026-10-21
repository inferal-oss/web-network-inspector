let highlighter;
const mimeLanguages = {
  json: "json",
  javascript: "javascript",
  ecmascript: "javascript",
  typescript: "typescript",
  html: "xml",
  xhtml: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  yaml: "yaml",
  toml: "ini",
  sql: "sql",
  graphql: "graphql",
  markdown: "markdown",
  "x-sh": "bash",
  "x-shellscript": "bash",
  "x-python": "python",
  "x-ruby": "ruby",
  "x-php": "php",
  "x-java-source": "java",
  "x-c": "c",
  "x-c++": "cpp",
  "x-rust": "rust",
};
const extensions = {
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  tsx: "typescript",
  yml: "yaml",
  htm: "xml",
  svg: "xml",
  toml: "ini",
  sh: "bash",
  rs: "rust",
  h: "c",
  md: "markdown",
  kt: "kotlin",
};
export function previewLanguage(hljs, contentType = "", url = "") {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  const subtype = mime.split("/")[1] || "";
  const suffix = subtype.split("+").at(-1);
  const candidates = [mimeLanguages[suffix], subtype.replace(/^x-/, "")];
  try {
    const path = new URL(url).pathname;
    const extension = path.split(".").at(-1).toLowerCase();
    candidates.push(extensions[extension], extension);
  } catch {}
  return candidates.find((language) => language && hljs.getLanguage(language));
}
/** Highlight the bounded source only while its renderer remains active. */
export async function highlightPreview(
  node,
  { contentType, url, language, active },
) {
  if (!node.textContent || !active()) return;
  try {
    highlighter ??= import("./vendor/highlight.js");
    const { default: hljs } = await highlighter;
    if (!active()) return;
    const source = node.textContent;
    language ||= previewLanguage(hljs, contentType, url);
    // Unknown types stay readable. Detect small snippets only; never run every
    // grammar against a large retained body on the UI thread.
    if (!language && source.length <= 2048)
      language = hljs.highlightAuto(source).language;
    if (!language || !hljs.getLanguage(language)) return;
    const result = hljs.highlight(source, { language, ignoreIllegals: true });
    if (!active()) return;
    node.innerHTML = result.value;
    node.classList.add("hljs");
    node.dataset.language = language;
  } catch {
    // Plain text remains available if an asset or language cannot be loaded.
  }
}
