import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { audio } from "./audio";
import { input } from "./input/InputManager";
import { useUI } from "./store";
import { game } from "./game/runtime";
import { net } from "./net/NetClient";
import "./styles.css";

// ---- stop the browser from scrolling, zooming or selecting text during play
const inGame = () => useUI.getState().screen === "game";
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("gesturechange", (e) => e.preventDefault(), { passive: false });
document.addEventListener(
  "touchmove",
  (e) => {
    if (inGame() && !(e.target as HTMLElement)?.closest?.(".settings")) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
document.addEventListener("contextmenu", (e) => {
  if (inGame()) e.preventDefault();
});
document.addEventListener("selectstart", (e) => {
  if (inGame() && (e.target as HTMLElement)?.tagName !== "INPUT") e.preventDefault();
});

// ---- automatically switch between touch and mouse/keyboard UI
window.addEventListener(
  "pointerdown",
  (e) => {
    audio.unlock();
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    if (touch !== useUI.getState().touchMode && (touch || e.pointerType === "mouse")) useUI.setState({ touchMode: touch });
  },
  { capture: true },
);
window.addEventListener("keydown", () => audio.unlock(), { once: true });

// ---- start ambience once the match runs
net.onState(() => {
  const p = net.state?.phase;
  if (p && p !== "lobby") audio.startAmbience();
  else audio.stopAmbience();
});

// Expose a small debug/testing handle (used by the automated browser tests).
(window as unknown as { __pp: unknown }).__pp = { game, net, input, ui: useUI };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
