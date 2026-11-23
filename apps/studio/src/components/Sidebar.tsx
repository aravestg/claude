import { useState } from 'react';
import { TEMPLATES } from '@asa/core-model';
import { useStudio } from '../store';
import { Catalog } from './Catalog';

const FOLDER = ['#e3a36b', '#5fae57', '#8a6fd6', '#e47f4f', '#2f86ce', '#2a9d8f'];
const Folder = ({ color }: { color: string }) => (
  <svg width="18" height="15" viewBox="0 0 24 20" aria-hidden>
    <path d="M1 3a2 2 0 0 1 2-2h6l2 3h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" fill={color} stroke="#1d1b18" strokeWidth="1.2" />
  </svg>
);
const Doc = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M6 2h9l5 5v15H6z M14 2v6h6" />
  </svg>
);

export function Sidebar() {
  const s = useStudio();
  const [open, setOpen] = useState<Record<string, boolean>>({ [s.templateId]: true });
  const all = TEMPLATES.flatMap((t) => t.scenarios().map((x) => `${t.id}:${x.id}`));
  const done = all.filter((k) => s.progress_[k]).length;
  return (
    <aside className="sidebar" aria-label="Escenarios y catálogo">
      <div className="sidebar__head">
        <span className="sidebar__title">
          <Folder color="#1d1b18" /> Escenarios
        </span>
        <span className="muted">{all.length} escenarios</span>
      </div>
      <div className="sidebar__body">
        <ul className="tree">
          {TEMPLATES.map((t, ti) => {
            const scs = t.scenarios();
            const isOpen = open[t.id] ?? t.id === s.templateId;
            const n = scs.filter((x) => s.progress_[`${t.id}:${x.id}`]).length;
            return (
              <li key={t.id}>
                <button className="tree__folder" onClick={() => setOpen({ ...open, [t.id]: !isOpen })} aria-expanded={isOpen}>
                  <span className="chev">{isOpen ? '⌄' : '›'}</span>
                  <Folder color={FOLDER[ti % FOLDER.length]!} />
                  <span className="tree__name">
                    {String(ti + 1).padStart(2, '0')}. {t.name}
                  </span>
                  <span className="muted">
                    {n}/{scs.length}
                  </span>
                </button>
                {isOpen && (
                  <ul className="tree__items">
                    {scs.map((x) => {
                      const active = t.id === s.templateId && x.id === s.scenarioId;
                      const res = s.progress_[`${t.id}:${x.id}`];
                      return (
                        <li key={x.id}>
                          <button className={`tree__item${active ? ' on' : ''}`} onClick={() => s.openScenario(t.id, x.id)} title={x.description} aria-current={active ? 'true' : undefined}>
                            <Doc />
                            <span>{x.name.replace(/^[A-Z] · /, '')}</span>
                            {res && <span className={`dot dot--${res}`} aria-label={`resultado ${res}`} />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <details className="sidebar__catalog" open={s.mode === 'design'}>
          <summary>
            <Folder color="#cfe3b2" /> Componentes
          </summary>
          <Catalog embedded />
        </details>
      </div>
      <div className="progress-card">
        <span>PROGRESO</span>
        <strong>
          {done} / {all.length}
        </strong>
      </div>
    </aside>
  );
}
