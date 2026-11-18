/**
 * Encabezado de "lección" y barra de escenarios (inspirado en el estilo de referencia).
 * Las métricas se derivan de los eventos ya reproducidos: avanzan con la línea de tiempo.
 */
import { useMemo } from 'react';
import { useStudio } from '../store';

export function LessonHeader() {
  const s = useStudio();
  const idx = s.scenarios.findIndex((x) => x.id === s.scenarioId);
  const scenario = s.scenarios[idx];
  const events = s.result?.events ?? [];
  const kpi = useMemo(() => {
    const played = events.slice(0, Math.max(0, s.cursor + 1));
    const done = played.filter((e) => e.type === 'REQUEST_COMPLETED');
    const last = played[played.length - 1];
    const lastHttp = [...played].reverse().find((e) => e.type === 'RESPONSE_RECEIVED')?.data.httpStatus;
    return {
      sent: played.filter((e) => e.type === 'REQUEST_STARTED').length,
      total: s.result?.requests.length ?? scenario?.requestCount ?? 0,
      ok: done.filter((e) => e.status === 'success').length,
      failed: done.filter((e) => e.status === 'error').length,
      errors: played.filter((e) => e.status === 'error').length,
      t: last?.t ?? 0,
      http: lastHttp
    };
  }, [events, s.cursor, s.result, scenario]);

  if (!scenario) return null;
  return (
    <div className="overlay overlay--tl lesson" data-testid="lesson-header">
      <div className="lesson__crumb">
        {s.model.name} / Escenario {idx + 1} de {s.scenarios.length}
        <span className="lesson__prov" title={`Principio P6: latencias estimadas.${s.runtime ? ` Motor en ${s.runtime}.` : ''}`}>
          Simulación basada en reglas · no es medición real
        </span>
      </div>
      <div className="lesson__row">
        <h2 className="lesson__title">{scenario.name.replace(/^[A-Z] · /, '')}</h2>
        <button className="chip" onClick={() => (s.result ? s.restart() : void s.simulate())} title="Repetir desde el inicio">
          ↺ Repetir
        </button>
        <button className="chip" onClick={() => (s.playing ? s.pause() : s.play())} title="Reproducir / pausar (Espacio)">
          {s.playing ? '❚❚ Pausa' : '▶ Reproducir'}
        </button>
      </div>
      <p className="lesson__desc">{scenario.description}</p>
      <div className="kpis" aria-label="Métricas simuladas">
        <div className="kpi">
          <span>solicitudes</span>
          <strong>
            {kpi.sent}/{kpi.total}
          </strong>
        </div>
        <div className="kpi kpi--ok">
          <span>exitosas</span>
          <strong>{kpi.ok}</strong>
        </div>
        <div className={`kpi${kpi.failed ? ' kpi--err' : ''}`}>
          <span>fallidas</span>
          <strong>{kpi.failed}</strong>
        </div>
        <div className="kpi">
          <span>t lógico</span>
          <strong>{kpi.t.toLocaleString('es')} ms</strong>
        </div>
        <div className={`kpi${kpi.errors ? ' kpi--err' : ''}`}>
          <span>eventos error</span>
          <strong>{kpi.errors}</strong>
        </div>
        <div className={`kpi${kpi.http && Number(kpi.http) >= 400 ? ' kpi--err' : kpi.http ? ' kpi--ok' : ''}`}>
          <span>última HTTP</span>
          <strong>{kpi.http !== undefined ? String(kpi.http) : '—'}</strong>
        </div>
      </div>
    </div>
  );
}

export function ScenarioStepper() {
  const s = useStudio();
  const current = s.scenarios.findIndex((x) => x.id === s.scenarioId);
  return (
    <nav className="overlay overlay--bc stepper" aria-label="Escenarios de la plantilla">
      <span className="stepper__label">En esta plantilla</span>
      <ol>
        {s.scenarios.map((x, i) => (
          <li key={x.id} className={i === current ? 'on' : i < current ? 'past' : ''}>
            <button
              onClick={() => {
                s.setScenario(x.id);
                if (!x.setup?.length) void s.simulate();
              }}
              title={x.description}
              aria-current={i === current ? 'step' : undefined}
            >
              <i aria-hidden>{i + 1}</i>
              <span>{x.name.replace(/^[A-Z] · /, '')}</span>
            </button>
          </li>
        ))}
      </ol>
      <span className="stepper__label">
        {s.result ? `Paso ${Math.max(0, s.cursor) + 1} de ${s.result.events.length}` : 'Pulse ▶ para simular'}
      </span>
    </nav>
  );
}
