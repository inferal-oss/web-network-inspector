// Shared by the organization homepage and its project sites.
(() => {
  const config = {
    version: 1,
    defaultProfile: "standard",
    storageKey: "inferal-oss-display-v1",
    controlLabel: "Display preferences",
    profiles: [
      {
        id: "standard",
        label: "Standard",
        description: "Original text size and colors.",
      },
      {
        id: "vision",
        label: "Vision",
        description: "Larger text with more room to read.",
        tokens: {
          "--regard-font-size": "125%",
          "--regard-line-height": "1.65",
        },
      },
      {
        id: "clarity",
        label: "Clarity",
        description: "Larger text, stronger contrast, and more spacing.",
        tokens: {
          "--regard-font-size": "125%",
          "--regard-line-height": "1.7",
          "--regard-letter-spacing": "0.025em",
          "--regard-word-spacing": "0.08em",
          "--ink": "#101a2b",
          "--muted": "#334155",
          "--line": "#8995a5",
          "--blue": "#0645ad",
          "--blue-dark": "#003584",
        },
      },
      {
        id: "contrast",
        label: "Contrast",
        description: "Larger text and maximum light-background contrast.",
        tokens: {
          "--regard-font-size": "125%",
          "--regard-line-height": "1.7",
          "--regard-letter-spacing": "0.025em",
          "--regard-word-spacing": "0.08em",
          "--page": "#ffffff",
          "--surface": "#ffffff",
          "--ink": "#000000",
          "--muted": "#111111",
          "--line": "#555555",
          "--blue": "#003a9d",
          "--blue-dark": "#002b78",
        },
      },
    ],
  };
  const display = OpenRegardDisplay.createDisplay(config);
  display.start();
  window.inferalDisplay = display;
  window.mountInferalDisplay = (container) =>
    OpenRegardDisplay.mountDisplayWidget(container, display, {
      className: "inferal-display",
      icon: false,
    });
  function mount() {
    for (const node of document.querySelectorAll("[data-inferal-display]"))
      window.mountInferalDisplay(node);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
