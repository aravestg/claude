import { useMemo } from 'react';
import type { Recommendation } from '@asa/core-model';
import { compatibleProtocols, effectiveProps, getDefinition, hasDefinition, nextId, validateModel } from '@asa/core-model';
import { useStudio } from '../store';
import type { RightTab } from '../store';
import { PropEditor } from './PropEditor';

const TABS: { id: RightTab; label: string }[] = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'learn', label: 'Aprender' },
  { id: 'recommendations', label: 'Diagnóstico' },
  { id: 'validation', label: 'Validación' }
];

export function RightPanel() {
  const tab = useStudio((s) => s.rightTab);
  const set = useStudio((s) => s.set);
  const recs = useStudio((s) => s.recommendations.length);
  return (
    <aside className="panel panel--right" aria-label="Panel contextual">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => set({ rightTab: t.id })}>
            {t.label}
            {t.id === 'recommendations' && recs > 0 && <span className="count">{recs}</span>}
          </button>
        ))}
      </div>
      <div className="panel__body" role="tabpanel">
        {tab === 'inspector' && <Inspector />}
        {tab === 'learn' && <Learn />}
        {tab === 'recommendations' && <Recommendations />}
        {tab === 'validation' && <Validation />}
      </div>
    </aside>
  );
}

function Inspector() {
  const s = useStudio();
  const sel = s.selection;
  if (!sel) {
    return (
      <div className="empty">
        <h3>Nada seleccionado</h3>
        <p>Haga clic en un componente o conexión de la escena para ver y editar su configuración. Doble clic para enfocarlo.</p>
        <p className="muted small">Atajos: Espacio reproducir · ←/→ paso a paso · Supr eliminar · F enfocar · C conectar · Ctrl+Z deshacer.</p>
      </div>
    );
  }
  if (sel.kind === 'connection') return <ConnectionInspector id={sel.id} />;
  const c = s.model.components.find((x) => x.id === sel.id);
  if (!c) return null;
  const def = hasDefinition(c.type) ? getDefinition(c.type) : undefined;
  const props = effectiveProps<Record<string, never>>(c);
  const conns = s.model.connections.filter((k) => k.sourceId === c.id || k.targetId === c.id);
  const events = s.result?.events.filter((e) => e.sourceId === c.id || e.targetId === c.id) ?? [];
  const recs = s.recommendations.filter((r) => r.componentIds.includes(c.id));
  return (
    <div className="inspector" data-testid="inspector">
      <label className="field">
        <span>Nombre</span>
        <input key={c.id + c.name} defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && s.apply([{ op: 'update_component', componentId: c.id, patch: { name: e.target.value } }])} />
      </label>
      <dl className="kv">
        <dt>ID</dt>
        <dd>
          <code>{c.id}</code>
        </dd>
        <dt>Tipo</dt>
        <dd>{def?.label}</dd>
        <dt>Tecnología</dt>
        <dd>{def?.technology}</dd>
        <dt>Función</dt>
        <dd>{def?.description}</dd>
        {def && Object.keys(def.equivalents).length > 0 && (
          <>
            <dt>Equivalentes</dt>
            <dd>{Object.entries(def.equivalents).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(' · ')}</dd>
          </>
        )}
      </dl>
      <h4>Configuración</h4>
      <PropEditor value={props} onChange={(k, v) => s.apply([{ op: 'update_component', componentId: c.id, patch: { props: { [k]: v } } }])} />
      <h4>Conexiones ({conns.length})</h4>
      <ul className="list">
        {conns.map((k) => (
          <li key={k.id}>
            <button className="link" onClick={() => s.select({ kind: 'connection', id: k.id })}>
              {k.sourceId === c.id ? '→' : '←'} {s.model.components.find((x) => x.id === (k.sourceId === c.id ? k.targetId : k.sourceId))?.name} · {k.protocol}:{k.port}
            </button>
          </li>
        ))}
      </ul>
      {recs.length > 0 && (
        <>
          <h4>Recomendaciones</h4>
          <ul className="list">
            {recs.map((r) => (
              <li key={r.id}>
                <button className="link" onClick={() => s.set({ rightTab: 'recommendations' })}>
                  [{r.severity}] {r.problem}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Eventos registrados ({events.length})</h4>
      <ul className="list list--events">
        {events.slice(0, 30).map((e) => (
          <li key={e.id} className={`st-${e.status}`}>
            <button className="link" onClick={() => s.seek(e.seq)}>
              <code>{e.t} ms</code> {e.type}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            const id = nextId(s.model, c.id.replace(/-\d+$/, ''));
            const p = s.model.layout.positions[c.id] ?? { x: 0, y: 0, z: 0 };
            s.apply([{ op: 'add_component', component: { ...c, id, name: `${c.name} (copia)` }, position: { x: p.x + 2, y: 0, z: p.z + 2 } }], 'Componente duplicado (sin conexiones).');
          }}
        >
          Duplicar
        </button>
        <button className="btn btn--danger" onClick={() => s.apply([{ op: 'remove_component', componentId: c.id }], `${c.name} eliminado.`)}>
          Eliminar
        </button>
      </div>
    </div>
  );
}

function ConnectionInspector({ id }: { id: string }) {
  const s = useStudio();
  const k = s.model.connections.find((x) => x.id === id);
  if (!k) return null;
  const src = s.model.components.find((c) => c.id === k.sourceId)!;
  const dst = s.model.components.find((c) => c.id === k.targetId)!;
  const protos = compatibleProtocols(src.type, dst.type);
  const events = s.result?.events.filter((e) => e.connectionId === k.id) ?? [];
  const upd = (patch: Parameters<typeof s.apply>[0][number] extends infer O ? (O extends { op: 'update_connection'; patch: infer P } ? P : never) : never) =>
    s.apply([{ op: 'update_connection', connectionId: k.id, patch }]);
  return (
    <div className="inspector" data-testid="inspector">
      <h3>
        {src.name} → {dst.name}
      </h3>
      <p className="muted small">
        Conexión <code>{k.id}</code>. La semántica (protocolo, puerto) la evalúa el simulador; la curva 3D es sólo presentación.
      </p>
      <label className="field">
        <span>Protocolo</span>
        <select value={k.protocol} onChange={(e) => upd({ protocol: e.target.value as typeof k.protocol })}>
          {protos.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Puerto</span>
        <input key={`p${k.port}`} defaultValue={k.port} inputMode="numeric" onBlur={(e) => Number(e.target.value) !== k.port && Number.isInteger(Number(e.target.value)) && upd({ port: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Latencia estimada (ms)</span>
        <input key={`l${k.props.latencyMs}`} defaultValue={k.props.latencyMs} inputMode="numeric" onBlur={(e) => Number(e.target.value) !== k.props.latencyMs && upd({ props: { latencyMs: Math.max(0, Number(e.target.value) || 0) } })} />
      </label>
      <label className="field field--check">
        <input type="checkbox" checked={k.props.encrypted} onChange={(e) => upd({ props: { encrypted: e.target.checked } })} />
        <span>Cifrado (TLS)</span>
      </label>
      <h4>Comunicaciones simuladas ({events.length})</h4>
      <ul className="list list--events">
        {events.map((e) => (
          <li key={e.id} className={`st-${e.status}`}>
            <button className="link" onClick={() => s.seek(e.seq)}>
              <code>{e.t} ms</code> {e.type} {e.data.httpStatus ? `· ${String(e.data.httpStatus)}` : ''}
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn--danger" onClick={() => s.apply([{ op: 'remove_connection', connectionId: k.id }], 'Conexión eliminada.')}>
        Eliminar conexión
      </button>
    </div>
  );
}

function Learn() {
  const s = useStudio();
  const c = s.selection?.kind === 'component' ? s.model.components.find((x) => x.id === s.selection!.id) : undefined;
  if (!c || !hasDefinition(c.type)) {
    return (
      <div className="empty">
        <h3>Modo aprendizaje</h3>
        <p>Seleccione un componente para saber qué es, cuándo usarlo, cómo se comunica y sus riesgos. Las explicaciones de cada evento de la simulación están en la consola inferior.</p>
      </div>
    );
  }
  const d = getDefinition(c.type);
  const L = d.learn;
  return (
    <div className="learn">
      <div className="seg seg--full">
        <button className={s.level === 'basic' ? 'on' : ''} onClick={() => s.set({ level: 'basic' })}>
          Básico
        </button>
        <button className={s.level === 'advanced' ? 'on' : ''} onClick={() => s.set({ level: 'advanced' })}>
          Avanzado
        </button>
      </div>
      <h3>{d.label}</h3>
      <p className="lead">{s.level === 'basic' ? L.basic : L.advanced}</p>
      <dl className="kv kv--stack">
        <dt>Qué es</dt>
        <dd>{L.what}</dd>
        <dt>Cuándo usarlo</dt>
        <dd>{L.when}</dd>
        <dt>Cuándo evitarlo</dt>
        <dd>{L.avoid}</dd>
        <dt>Cómo se comunica</dt>
        <dd>{L.communicates}</dd>
        <dt>Qué necesita</dt>
        <dd>{L.needs}</dd>
        <dt>Alternativas</dt>
        <dd>{L.alternatives.join(', ')}</dd>
        <dt>Costos asociados</dt>
        <dd>{L.costs}</dd>
        <dt>Riesgos</dt>
        <dd>{L.risks.join(' · ')}</dd>
        <dt>Buenas prácticas</dt>
        <dd>{L.bestPractices.join(' · ')}</dd>
      </dl>
    </div>
  );
}

function Recommendations() {
  const s = useStudio();
  const last = s.runs[s.runs.length - 1];
  const prev = s.runs.length > 1 ? s.runs[s.runs.length - 2] : undefined;
  if (!s.result) {
    return (
      <div className="empty">
        <h3>Sin diagnóstico aún</h3>
        <p>Ejecute una simulación. Si hay fallas, el motor de reglas identifica la causa raíz y propone cambios que usted puede aceptar, posponer o rechazar.</p>
        <button className="btn btn--primary" onClick={() => void s.simulate()}>
          ▶ Simular escenario
        </button>
      </div>
    );
  }
  return (
    <div className="recs">
      {prev && last && prev.scenarioId === last.scenarioId && (
        <section className="compare" aria-label="Comparación antes y después">
          <h4>Antes / después</h4>
          <table>
            <thead>
              <tr>
                <th />
                <th>{prev.label}</th>
                <th>{last.label}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Resultado</td>
                <td>{prev.outcome}</td>
                <td>{last.outcome}</td>
              </tr>
              <tr>
                <td>Solicitudes OK</td>
                <td>
                  {prev.ok}/{prev.total}
                </td>
                <td>
                  {last.ok}/{last.total}
                </td>
              </tr>
              <tr>
                <td>Duración lógica total</td>
                <td>{prev.durationMs} ms</td>
                <td>{last.durationMs} ms</td>
              </tr>
              <tr>
                <td>Eventos de error</td>
                <td>{prev.errors}</td>
                <td>{last.errors}</td>
              </tr>
              <tr>
                <td>Causa raíz</td>
                <td>{prev.rootCauses.join(', ') || '—'}</td>
                <td>{last.rootCauses.join(', ') || '—'}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
      <p className="muted small">Motor de recomendaciones basado en reglas (Fase 1). El asistente IA (Fase 2) usará el mismo flujo de propuestas con confirmación.</p>
      {s.recommendations.length === 0 && <div className="empty">{s.result.outcome === 'success' ? '✔ Sin fallas en este escenario.' : 'No hay recomendaciones automáticas para esta falla.'}</div>}
      {s.recommendations.map((r) => (
        <RecCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function RecCard({ r }: { r: Recommendation }) {
  const s = useStudio();
  const decision = s.recDecisions[r.id];
  return (
    <article className={`rec sev-${r.severity}${decision ? ` rec--${decision}` : ''}`} data-testid="recommendation">
      <header>
        <span className={`sev sev-${r.severity}`}>{r.severity}</span>
        <span className="muted small">P{r.priority} · complejidad {r.complexity} · costo {r.costImpact}</span>
      </header>
      <h4>{r.problem}</h4>
      <p>
        <strong>Solución:</strong> {r.solution}
      </p>
      <details>
        <summary>Detalle y trade-offs</summary>
        <dl className="kv kv--stack">
          <dt>Evidencia ({r.evidenceKind === 'simulation' ? 'simulación' : r.evidenceKind})</dt>
          <dd>{r.evidence}</dd>
          <dt>Componentes</dt>
          <dd>{r.componentIds.join(', ')}</dd>
          <dt>Riesgo</dt>
          <dd>{r.risk}</dd>
          <dt>Justificación</dt>
          <dd>{r.justification}</dd>
          <dt>Beneficios</dt>
          <dd>{r.benefits.join(' · ') || '—'}</dd>
          <dt>Trade-offs</dt>
          <dd>{r.tradeoffs.join(' · ') || '—'}</dd>
          <dt>Alternativas</dt>
          <dd>{r.alternatives.join(' · ') || '—'}</dd>
        </dl>
      </details>
      {decision ? (
        <p className="muted small">Decisión: {decision === 'accepted' ? 'aceptada' : decision === 'rejected' ? 'rechazada' : 'pospuesta'}</p>
      ) : (
        <div className="row">
          {r.proposal && (
            <button
              className="btn btn--primary btn--small"
              onClick={() => {
                s.decideRecommendation(r.id, 'accepted');
                s.propose(r.proposal!);
              }}
            >
              Aceptar y previsualizar
            </button>
          )}
          <button className="btn btn--small" onClick={() => s.decideRecommendation(r.id, 'postponed')}>
            Posponer
          </button>
          <button className="btn btn--small" onClick={() => s.decideRecommendation(r.id, 'rejected')}>
            Rechazar
          </button>
        </div>
      )}
    </article>
  );
}

function Validation() {
  const s = useStudio();
  const findings = useMemo(() => validateModel(s.model), [s.model]);
  const icon = { error: '✖', warning: '!', info: 'i' } as const;
  return (
    <div className="validation">
      <p className="muted small">Validación estática de topología y configuración (no requiere simular).</p>
      {findings.length === 0 && <div className="empty">✔ Sin hallazgos.</div>}
      <ul className="list">
        {findings.map((f) => (
          <li key={f.id} className={`finding finding--${f.level}`}>
            <span aria-label={f.level}>{icon[f.level]}</span>
            <button
              className="link"
              onClick={() =>
                f.connectionId ? s.select({ kind: 'connection', id: f.connectionId }) : f.componentIds[0] && s.select({ kind: 'component', id: f.componentIds[0] })
              }
            >
              {f.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
