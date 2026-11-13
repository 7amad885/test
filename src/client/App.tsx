import { lazy, Suspense, useEffect } from "react";
import { useHud } from "./game/runtime";
import { net } from "./net/NetClient";
import { useUI } from "./store";
import { Hud } from "./ui/Hud";
import { GameOverlays, Home, Lobby, RotateHint } from "./ui/Menus";
import { Settings } from "./ui/Settings";
import { TouchControls } from "./ui/TouchControls";

const GameCanvas = lazy(() => import("./game/GameCanvas").then((m) => ({ default: m.GameCanvas })));

export function App() {
  const screen = useUI((s) => s.screen);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const layoutEditor = useUI((s) => s.layoutEditor);
  const touch = useUI((s) => s.touchMode);
  const phase = useHud((s) => s.phase);

  // Lobby -> game as soon as the server starts the match (and back to game after reconnects).
  useEffect(() => {
    const off = net.onState(() => {
      const p = net.state?.phase;
      const cur = useUI.getState().screen;
      if (p && p !== "lobby" && cur !== "game") useUI.getState().setScreen("game");
    });
    return () => {
      off();
    };
  }, []);

  const inGame = screen === "game";
  return (
    <div className={inGame ? "game-root" : undefined} style={{ position: "fixed", inset: 0 }}>
      <Suspense fallback={<div className="loading">LOADING ARENA</div>}>
        <GameCanvas />
      </Suspense>
      {screen === "home" && <Home />}
      {screen === "lobby" && <Lobby />}
      {inGame && (
        <>
          <Hud />
          {(touch || layoutEditor) && <TouchControls />}
          <GameOverlays />
          <RotateHint />
        </>
      )}
      {settingsOpen && <Settings inGame={inGame && phase !== "lobby"} />}
    </div>
  );
}
