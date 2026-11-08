import { companionStates } from "./companion-view.js";

const popup = window.pcAgentCompanion;
const companion = document.getElementById("companion");
const status = document.getElementById("companion-state");
const pin = document.getElementById("pin");
const close = () => popup?.close();

if (popup) {
  popup.onState(({ phase, pinned }) => {
    companion.dataset.state = phase;
    const label = companionStates[phase][0];
    if (status.textContent !== label) status.textContent = label;
    pin.disabled = phase === "game";
    pin.setAttribute("aria-pressed", String(pinned));
    pin.textContent = pinned ? "已置顶" : "置顶";
    pin.title = phase === "game" ? "游戏模式暂停置顶" : pinned ? "取消置顶" : "让人物保持在其他窗口上方";
  });
  popup.ready();
  pin.addEventListener("click", () => popup.togglePin());
  document.getElementById("close").addEventListener("click", close);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
} else {
  pin.disabled = true;
  document.getElementById("close").disabled = true;
}
