import { useMemo, useState } from 'react';
import type { ComponentDefinition } from '@asa/core-model';
import { listDefinitions, nextId } from '@asa/core-model';
import { useStudio } from '../store';

const CATEGORY_LABEL: Record<string, string> = {
  client: 'Clientes',
  network: 'Redes',
  edge: 'Borde',
  security: 'Seguridad',
  integration: 'Integración',
  compute: 'Cómputo',
  data: 'Datos'
};

export function Catalog({ embedded = false }: { embedded?: boolean }) {
  const apply = useStudio((s) => s.apply);
  const model = useStudio((s) => s.model);
  const select = useStudio((s) => s.select);
  const [q, setQ] = useState('');
  const defs = useMemo(() => {
    const term = q.trim().toLowerCase();
    return listDefinitions().filter(
      (d) => !term || [d.label, d.technology, d.description, ...Object.values(d.equivalents)].join(' ').toLowerCase().includes(term)
    );
  }, [q]);
  const groups = useMemo(() => {
    const m = new Map<string, ComponentDefinition[]>();
    for (const d of defs) m.set(d.category, [...(m.get(d.category) ?? []), d]);
    return [...m.entries()];
  }, [defs]);

  const add = (d: ComponentDefinition) => {
    const id = nextId(model, d.type.split('.')[1]!.replace(/_/g, '-'));
    const zs = Object.values(model.layout.positions).map((p) => p.z);
    const position = { x: 0, y: 0, z: (zs.length ? Math.max(...zs) : 0) + 6 };
    if (apply([{ op: 'add_component', component: { id, type: d.type, name: d.label, props: {} }, position }], `${d.label} agregado. Use «Conectar» para enlazarlo.`)) {
      select({ kind: 'component', id });
    }
  };

  const body = (
      <div className={embedded ? 'catalog' : 'panel__body'}>
        <label className="field">
          <span>Buscar</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="p.ej. Lambda, RDS, firewall" />
        </label>
        {groups.length === 0 && <p className="muted">Sin resultados para «{q}». Pruebe con el nombre de un servicio (RDS, Lambda…).</p>}
        {groups.map(([cat, list]) => (
          <section key={cat} className="catalog-group">
            <h3>{CATEGORY_LABEL[cat] ?? cat}</h3>
            {list.map((d) => (
              <button key={d.type} className="catalog-item" onClick={() => add(d)} title={`${d.description}\nEquivalentes: ${Object.entries(d.equivalents).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}`}>
                <span className={`catalog-item__dot cat-${d.category}`} aria-hidden />
                <span>
                  <strong>{d.label}</strong>
                  <small>{d.technology}</small>
                </span>
                <span className="catalog-item__add" aria-hidden>
                  +
                </span>
              </button>
            ))}
          </section>
        ))}
        <p className="muted small">Definiciones declarativas, extensibles con <code>registerDefinition</code>.</p>
      </div>
  );
  if (embedded) return body;
  return (
    <aside className="panel panel--left" aria-label="Catálogo de componentes">
      {body}
    </aside>
  );
}
