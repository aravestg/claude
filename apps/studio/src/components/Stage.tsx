/** Tarjeta central: encabezado del escenario, métricas, escena 3D y stepper. */
import { useMemo, useState } from 'react';
import { TEMPLATES } from '@asa/core-model';
import { isDrawioName } from '../drawio';
import { chaptersOf, currentChapter, KIND_LABEL } from '../lesson';
import { useStudio } from '../store';
import { ICONS, Svg } from './TopNav';
import { Viewport } from './Viewport';

export function Stage() {
  const s = useStudio();
  const idx = s.scenarios.findIndex((x) => x.id === s.scenarioId);
  const scenario = s.scenarios[idx];
  const tpl = TEMPLATES.find((t) => t.id === s.templateId);
  const kind = KIND_LABEL[scenario?.kind ?? 'custom']!;
  const [dragging, setDragging] = useState(false);
  const events = s.result?.events ?? [];
  const kpi = useMemo(() => {
    const played = events.slice(0, Math.max(0, s.cursor + 1));
    const done = played.filter((e) => e.type === 'REQUEST_COMPLETED');
    const lastHttp = [...played].reverse().find((e) => e.type === 'RESPONSE_RECEIVED')?.data.httpStatus;
    return {
      sent: played.filter((e) => e.type === 'REQUEST_STARTED').length,
      total: s.result?.requests.length ?? scenario?.requestCount ?? 0,
      ok: done.filter((e) => e.status === 'success').length,
      failed: done.filter((e) => e.status === 'error').length,
      t: played[played.length - 1]?.t ?? 0,
      http: lastHttp
    };
  }, [events, s.cursor, s.result, scenario]);

  return (
    <main className="stage">
      <section
        className={`card stage__card${dragging ? ' stage__card--drop' : ''}`}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          const f = e.dataTransfer.files[0];
          setDragging(false);
          if (!f) return;
          e.preventDefault();
          if (isDrawioName(f.name)) s.openImport(f);
          else s.notify('error', 'Suelte un archivo .drawio, .xml o .drawio.svg.');
        }}
      >
        <header className="stage__head">
          <div>
            <div className="crumb">
              {tpl?.name ?? (s.templateId === 'imported' ? 'Importado desde draw.io' : '')} <span>/</span> {scenario ? `Escenario ${idx + 1} de ${s.scenarios.length}` : s.model.name}
            </div>
            <h1 className="title" data-testid="lesson-title">
              {scenario ? scenario.name.replace(/^[A-Z] · /, '') : s.model.name}
            </h1>
            <p className="subtitle">{scenario ? scenario.description : 'Este modelo no tiene un punto de entrada simulable todavía: agregue un usuario y conexiones en el modo Diseñar.'}</p>
          </div>
          <div className="chips">
            <span className="chip chip--amber">
              <Svg d={ICONS.clock} size={13} /> {scenario?.requestCount ?? 0} solicitud{(scenario?.requestCount ?? 0) === 1 ? '' : 'es'}
            </span>
            <span className={`chip chip--${kind.tone}`}>{kind.label}</span>
            <span className="chip chip--violet">≡ {events.length || '—'} pasos</span>
            <label className="chip chip--select">
              <span className="sr-only">Escenario</span>
              <select value={s.scenarioId} onChange={(e) => s.setScenario(e.target.value)} aria-label="Escenario" data-testid="scenario-select">
                {s.scenarios.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="canvas-wrap">
          <div className="canvas-top">
          <div className="metrics" aria-label="Métricas simuladas">
            <Metric label="Solicitudes" value={`${kpi.sent} / ${kpi.total}`} tone={kpi.sent ? 'ink' : ''} icon="◎" />
            <Metric label="Exitosas" value={String(kpi.ok)} tone={kpi.ok ? 'green' : ''} icon="✓" />
            <Metric label="Fallidas" value={String(kpi.failed)} tone={kpi.failed ? 'red' : ''} icon="✕" />
            <Metric label="T lógico" value={`${kpi.t.toLocaleString('es')} ms`} tone={kpi.t ? 'amber' : ''} icon="◷" />
            <Metric label="Última HTTP" value={kpi.http !== undefined ? String(kpi.http) : '—'} tone={kpi.http === undefined ? '' : Number(kpi.http) >= 400 ? 'red' : 'green'} icon="↩" />
          </div>
          <div className="stage__actions">
            {scenario?.setup?.length ? (
              <button className="pop pop--amber" onClick={s.prepareScenario} title="Aplica al modelo la configuración del escenario (con confirmación)">
                Aplicar configuración
              </button>
            ) : null}
            <button className="pop pop--green" onClick={() => void s.simulate()} disabled={s.running || !scenario} data-testid="run-simulation">
              <Svg d={ICONS.play} size={13} /> {s.running ? 'Simulando…' : 'Simular'}
            </button>
            <button className="pop" onClick={s.restart} disabled={!s.result} title="Repetir desde el inicio (R)">
              ↺ Replay
            </button>
            {s.playing ? (
              <button className="pop" onClick={s.pause} data-testid="pause" title="Pausa (Espacio)">
                ❚❚ Pause
              </button>
            ) : (
              <button className="pop" onClick={s.play} data-testid="play" title="Reproducir (Espacio)">
                ▶ Play
              </button>
            )}
          </div>
          </div>
          <Viewport />
        </div>
      </section>
      <Stepper />
    </main>
  );
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: string; icon: string }) {
  return (
    <div className={`metric${tone ? ` metric--${tone}` : ''}`}>
      <span>
        <i aria-hidden>{icon}</i> {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function Stepper() {
  const s = useStudio();
  const events = s.result?.events ?? [];
  const chapters = useMemo(() => chaptersOf(events), [events]);
  const cur = currentChapter(chapters, s.cursor);
  const current = s.cursor >= 0 ? events[s.cursor] : undefined;
  return (
    <section className="card stepper" aria-label="En este escenario">
      <div className="stepper__head">
        <span className="eyebrow">En este escenario</span>
        <span className="muted">{s.result ? `Paso ${Math.max(0, s.cursor) + 1} de ${events.length}` : 'Pulse Simular para comenzar'}</span>
      </div>
      {chapters.length ? (
        <ol className="chapters" style={{ ['--n' as string]: chapters.length }}>
          {chapters.map((c, i) => (
            <li key={`${c.label}-${c.startSeq}`} className={`${i < cur ? 'past' : ''}${i === cur ? ' on' : ''}${c.status === 'error' ? ' err' : ''}`}>
              <button onClick={() => s.seek(c.startSeq)} aria-current={i === cur ? 'step' : undefined} title={`Ir a «${c.label}»`}>
                <i>{c.status === 'error' && i <= cur ? '✕' : i + 1}</i>
                <span>{c.label}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="chapters chapters--empty">
          {['Inicio', 'DNS', 'Conexión', 'Seguridad', 'Balanceo', 'Backend', 'Datos', 'Respuesta'].map((l, i) => (
            <li key={l}>
              <button disabled>
                <i>{i + 1}</i>
                <span>{l}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="scrub">
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
        <span className="scrub__status" data-testid="sim-status">
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
    </section>
  );
}
