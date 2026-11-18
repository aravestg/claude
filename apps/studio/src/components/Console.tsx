import { useEffect, useRef } from 'react';
import type { SimulationEvent } from '@asa/core-model';
import { STATUS_COLOR } from '@asa/visualization-3d';
import { useStudio } from '../store';

const ICON: Record<SimulationEvent['status'], string> = { info: '·', active: '→', success: '✔', warning: '!', error: '✖' };
const COLOR: Record<SimulationEvent['status'], string> = {
  info: STATUS_COLOR.idle,
  active: STATUS_COLOR.active,
  success: STATUS_COLOR.ok,
  warning: STATUS_COLOR.warning,
  error: STATUS_COLOR.error
};
const FAILURE_LABEL: Record<string, string> = {
  network: 'Bloqueo de red',
  authorization: 'Autorización',
  authentication: 'Autenticación',
  availability: 'Disponibilidad',
  application: 'Aplicación',
  capacity: 'Capacidad',
  dns: 'DNS'
};

export function Console() {
  const s = useStudio();
  const events = s.result?.events ?? [];
  const current = s.cursor >= 0 ? events[s.cursor] : undefined;
  const listRef = useRef<HTMLOListElement>(null);
  const name = (id?: string) => (id ? (s.model.components.find((c) => c.id === id)?.name ?? id) : '');

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [s.cursor]);

  return (
    <section className="console" aria-label="Consola de simulación">
      <div className="console__controls" role="toolbar" aria-label="Reproducción">
        <button className="icon-btn" onClick={s.stop} title="Detener" aria-label="Detener" disabled={!s.result}>
          ■
        </button>
        <button className="icon-btn" onClick={() => s.step(-1)} title="Paso atrás (←)" aria-label="Paso atrás" disabled={!s.result} data-testid="step-back">
          ⏮
        </button>
        {s.playing ? (
          <button className="icon-btn icon-btn--primary" onClick={s.pause} title="Pausa (Espacio)" aria-label="Pausa" data-testid="pause">
            ❚❚
          </button>
        ) : (
          <button className="icon-btn icon-btn--primary" onClick={s.play} title="Reproducir (Espacio)" aria-label="Reproducir" data-testid="play">
            ▶
          </button>
        )}
        <button className="icon-btn" onClick={() => s.step(1)} title="Paso adelante (→)" aria-label="Paso adelante" disabled={!s.result} data-testid="step-forward">
          ⏭
        </button>
        <button className="icon-btn" onClick={s.restart} title="Reiniciar" aria-label="Reiniciar" disabled={!s.result}>
          ↺
        </button>
        <label className="speed">
          Velocidad
          <select value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} aria-label="Velocidad de reproducción">
            {[0.25, 0.5, 1, 2, 4, 8].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        <div className="timeline" aria-label="Línea de tiempo">
          <div className="timeline__ticks" aria-hidden>
            {events.map((e) => (
              <i key={e.id} style={{ background: COLOR[e.status], opacity: e.seq <= s.cursor ? 1 : 0.35 }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, events.length - 1)}
            value={Math.max(0, s.cursor)}
            onChange={(e) => s.seek(Number(e.target.value))}
            disabled={!events.length}
            aria-label="Posición en la línea de tiempo"
            aria-valuetext={current ? `${current.type} en t=${current.t} ms` : 'sin eventos'}
            data-testid="timeline"
          />
        </div>
        <span className="console__meta" data-testid="sim-status">
          {s.result ? (
            <>
              <span className={`outcome outcome--${s.result.outcome}`}>{s.result.outcome === 'success' ? '✔ Éxito' : s.result.outcome === 'partial' ? '◐ Parcial' : '✖ Falla'}</span> · evento {Math.max(0, s.cursor) + 1}/{events.length}
              {current ? ` · t=${current.t} ms` : ''}
            </>
          ) : (
            'Sin simulación'
          )}
        </span>
      </div>

      <div className="console__body">
        <ol className="events" ref={listRef} aria-label="Eventos" data-testid="event-list">
          {!events.length && (
            <li className="events__empty">
              Seleccione un escenario y pulse <strong>▶ Simular</strong>. Cada paso de la animación corresponde a un evento estructurado emitido por el motor de simulación.
            </li>
          )}
          {events.map((e) => (
            <li key={e.id} aria-current={e.seq === s.cursor} className={`ev st-${e.status}${e.seq > s.cursor ? ' ev--future' : ''}`}>
              <button onClick={() => s.seek(e.seq)}>
                <span className="ev__t">{e.t} ms</span>
                <span className="ev__icon" style={{ color: COLOR[e.status] }} aria-label={e.status}>
                  {ICON[e.status]}
                </span>
                <span className="ev__type">{e.type}</span>
                <span className="ev__msg">{e.message}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="event-inspector" aria-live="polite" data-testid="event-inspector">
          {current ? (
            <>
              <div className="row row--between">
                <h3>
                  <span style={{ color: COLOR[current.status] }}>{ICON[current.status]}</span> {current.type}
                </h3>
                <div className="seg">
                  <button className={s.level === 'basic' ? 'on' : ''} onClick={() => s.set({ level: 'basic' })}>
                    Básico
                  </button>
                  <button className={s.level === 'advanced' ? 'on' : ''} onClick={() => s.set({ level: 'advanced' })}>
                    Avanzado
                  </button>
                </div>
              </div>
              <p className="lead">{current.message}</p>
              <p>{s.level === 'basic' ? current.explanation.basic : current.explanation.advanced}</p>
              <dl className="kv">
                <dt>Tiempo lógico</dt>
                <dd>
                  t = {current.t} ms{current.duration ? ` (+${current.duration} ms)` : ''}
                </dd>
                <dt>Componentes</dt>
                <dd>
                  {name(current.sourceId)}
                  {current.targetId ? ` → ${name(current.targetId)}` : ''}
                </dd>
                {current.data.protocol && (
                  <>
                    <dt>Protocolo / puerto</dt>
                    <dd>
                      {current.data.protocol}
                      {current.data.port ? `:${current.data.port}` : ''}
                    </dd>
                  </>
                )}
                {current.data.httpStatus !== undefined && (
                  <>
                    <dt>HTTP</dt>
                    <dd>{String(current.data.httpStatus)}</dd>
                  </>
                )}
                {current.failure && (
                  <>
                    <dt>Tipo de falla</dt>
                    <dd>{FAILURE_LABEL[current.failure]}</dd>
                  </>
                )}
                <dt>Traza</dt>
                <dd>
                  <code>{current.traceId}</code>
                </dd>
                <dt>Observabilidad</dt>
                <dd>{current.observableInRealSystem ? 'Observable en un sistema real (logs/métricas)' : 'Sólo visible en la simulación'}</dd>
                <dt>Procedencia</dt>
                <dd>Simulación basada en reglas</dd>
              </dl>
              <details>
                <summary>Datos técnicos (payload sintético, encabezados)</summary>
                <pre>{JSON.stringify(current.data, null, 2)}</pre>
              </details>
            </>
          ) : (
            <div className="empty">
              <p>El inspector de simulación muestra el evento actual: protocolo, puerto, payload sintético, causa y explicación.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
