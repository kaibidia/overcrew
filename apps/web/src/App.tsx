import { useSyncExternalStore } from "react";
import { Playground } from "./playground/Playground";
import { RoomApp } from "./screens/RoomApp";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/**
 * Default: the Stage 2 room/lobby flow. `#playground` keeps the Stage 1 control
 * playground reachable for control testing.
 */
export function App() {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  return hash === "#playground" ? <Playground /> : <RoomApp />;
}
