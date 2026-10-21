for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select the command to copy";
    }
  });
}
for (const pre of document.querySelectorAll(".doc-content pre")) {
  const button = document.createElement("button");
  button.className = "code-copy";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy code example");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        pre.querySelector("code").textContent,
      );
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select to copy";
    }
  });
  pre.append(button);
}
const tabs = [...document.querySelectorAll("[data-code-tab]")];
function activate(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(`example-${item.dataset.codeTab}`).hidden =
      !selected;
  }
}
for (const tab of tabs) {
  tab.addEventListener("click", () => activate(tab));
  tab.addEventListener("keydown", (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    activate(tabs[index]);
    tabs[index].focus();
  });
}
