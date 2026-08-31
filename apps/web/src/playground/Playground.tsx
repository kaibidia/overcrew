import { useEffect, useReducer } from "react";
import { DEMO_SLIDER_TASK, PROTOCOL_VERSION } from "@overcrew/shared";
import { ControlRenderer } from "../controls/ControlRenderer";
import { initState, reducer } from "./state";

export function Playground() {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  // Drop the "just touched" highlight shortly after the last interaction.
  useEffect(() => {
    if (state.activeId === null) return;
    const t = window.setTimeout(() => dispatch({ type: "clearActive" }), 600);
    return () => window.clearTimeout(t);
  }, [state.activeId, state.nextLogId]);

  return (
    <div className="playground">
      <header className="playground__bar">
        <h1 className="playground__title">OVERCREW</h1>
        <span className="playground__tag">ПОЛИГОН · STAGE 1</span>
        <button
          type="button"
          className="playground__reset"
          onClick={() => dispatch({ type: "reset" })}
        >
          СБРОС
        </button>
      </header>

      <main className="playground__grid">
        {state.panel.map((instance) => (
          <ControlRenderer
            key={`${state.generation}:${instance.id}`}
            instance={instance}
            active={state.activeId === instance.id}
            sliderTask={
              instance.definition.kind === "slider" ? DEMO_SLIDER_TASK : undefined
            }
            onEvent={(event) =>
              dispatch({ type: "event", controlId: instance.id, event })
            }
          />
        ))}
      </main>

      <section className="playground__log" aria-live="polite">
        <h2 className="playground__log-title">СОБЫТИЯ</h2>
        {state.log.length === 0 ? (
          <p className="playground__log-empty">Тронь любой контрол.</p>
        ) : (
          <ul>
            {state.log.map((e) => (
              <li key={e.id}>{e.text}</li>
            ))}
          </ul>
        )}
      </section>

      <footer className="playground__foot">
        протокол v{PROTOCOL_VERSION} · без сети · без игрового цикла
      </footer>
    </div>
  );
}
