import { useEffect, useRef } from 'react';
import { previewProposal } from '@asa/core-model';
import { useStudio } from '../store';

/** Previsualización de cambios: nada se aplica sin confirmación explícita (principio P5). */
export function ProposalDialog() {
  const p = useStudio((s) => s.pendingProposal);
  const model = useStudio((s) => s.model);
  const decide = useStudio((s) => s.decide);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p && !d.open) d.showModal();
    if (!p && d.open) d.close();
  }, [p]);
  const preview = p ? previewProposal(model, p) : null;
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => (e.preventDefault(), decide('postponed'))} aria-labelledby="proposal-title" data-testid="proposal-dialog">
      {p && (
        <>
          <h2 id="proposal-title">{p.title}</h2>
          <p className="muted small">
            Origen: {p.source === 'rule-engine' ? 'motor de reglas' : p.source === 'ai' ? 'asistente IA' : 'escenario'} · sobre la revisión {p.baseRevision}
          </p>
          <p>{p.rationale}</p>
          <h3>Cambios al modelo</h3>
          {preview && !preview.ok && <p className="error">No válido: {preview.errors.join('; ')}</p>}
          <ul className="diff">
            {p.operations.map((op, i) => {
              if (op.op !== 'update_component') return <li key={i}><code>{JSON.stringify(op)}</code></li>;
              const before = model.components.find((c) => c.id === op.componentId);
              return (
                <li key={i}>
                  <strong>{before?.name ?? op.componentId}</strong>
                  {Object.entries(op.patch.props ?? {}).map(([k, v]) => (
                    <div key={k} className="diff__row">
                      <code>{k}</code>
                      <pre className="diff__old">{JSON.stringify(before?.props[k] ?? '(valor por defecto)', null, 1)}</pre>
                      <span aria-hidden>→</span>
                      <pre className="diff__new">{JSON.stringify(v, null, 1)}</pre>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          <p className="muted small">La vista 3D se actualizará al aplicar. Puede deshacer con Ctrl+Z.</p>
          <div className="row row--end">
            <button className="btn" onClick={() => decide('rejected')}>
              Rechazar
            </button>
            <button className="btn" onClick={() => decide('postponed')}>
              Posponer
            </button>
            <button className="btn btn--primary" onClick={() => decide('approved')} disabled={!preview?.ok} data-testid="approve-proposal">
              Aprobar y aplicar
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
