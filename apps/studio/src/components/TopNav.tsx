import { useRef, useState } from 'react';
import { toMarkdownReport, toMermaid, validateModel } from '@asa/core-model';
import { download, slug } from '../download';
import { listVersions, saveVersion } from '../persistence';
import { useStudio } from '../store';

const I = {
  logo: 'M4 4h7v7H4z M13 13h7v7h-7z M13 4h7v4h-7z M4 15h7v5H4z',
  play: 'M7 5l12 7l-12 7z',
  pencil: 'M4 20h4l11-11l-4-4L4 16z',
  pulse: 'M3 12h4l3-7l4 14l3-7h4',
  down: 'M12 4v12 M6 11l6 6l6-6 M5 20h14',
  up: 'M12 16V4 M6 9l6-6l6 6 M5 20h14',
  save: 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5l-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  moon: 'M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z',
  sun: 'M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5 5L3.6 3.6 M20.4 20.4L19 19 M5 19l-1.4 1.4 M20.4 3.6L19 5 M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z M12 7v5l3 2'
};
export const Svg = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
export const ICONS = I;

export function TopNav() {
  const s = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<'export' | 'versions' | null>(null);
  const name = slug(s.model.name);
  const exportPng = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="scene"] canvas');
    if (!canvas) return s.notify('error', 'No se encontró el lienzo 3D.');
    canvas.toBlob((b) => b && download(`${name}-vista3d.png`, b));
  };
  return (
    <header className="topnav" role="banner">
      <div className="logo">
        <span className="logo__mark">
          <Svg d={I.logo} size={22} />
        </span>
        <span className="logo__text">
          Architecture <mark>Studio</mark>
        </span>
      </div>
      <nav className="navtabs" aria-label="Modo">
        <button className={s.mode === 'simulate' ? 'on' : ''} onClick={() => s.setMode('simulate')} aria-pressed={s.mode === 'simulate'}>
          <Svg d={I.play} /> Simular
        </button>
        <button className={s.mode === 'design' ? 'on' : ''} onClick={() => s.setMode('design')} aria-pressed={s.mode === 'design'} data-testid="mode-design">
          <Svg d={I.pencil} /> Diseñar
        </button>
        <button
          className={s.rightTab === 'recommendations' ? 'on' : ''}
          onClick={() => {
            s.setMode('simulate');
            s.set({ rightTab: 'recommendations' });
          }}
        >
          <Svg d={I.pulse} /> Diagnóstico{s.recommendations.length ? <span className="count">{s.recommendations.length}</span> : null}
        </button>
      </nav>
      <div className="navtools">
        <button className="pop pop--violet" onClick={() => s.openImport()} data-testid="open-import" title="Convertir un diagrama de draw.io en un modelo 3D simulable">
          <Svg d={I.up} /> Importar draw.io
        </button>
        <button className="tool" onClick={s.undo} disabled={!s.past.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
          <Svg d={I.undo} />
        </button>
        <button className="tool" onClick={s.redo} disabled={!s.future.length} title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">
          <Svg d={I.redo} />
        </button>
        <button
          className="tool tool--text"
          onClick={() => {
            const v = saveVersion(s.templateId, s.model, `${s.model.name} · rev.${s.model.revision}`);
            s.notify(v ? 'success' : 'error', v ? 'Versión guardada en este navegador.' : 'No se pudo guardar (almacenamiento no disponible).');
          }}
          title="Guardar versión"
        >
          <Svg d={I.save} /> Guardar
        </button>
        <div className="menu">
          <button className="tool tool--text" aria-haspopup="menu" aria-expanded={menu === 'versions'} onClick={() => setMenu(menu === 'versions' ? null : 'versions')}>
            <Svg d={I.clock} /> Versiones
          </button>
          {menu === 'versions' && (
            <div className="menu__list" role="menu" onMouseLeave={() => setMenu(null)}>
              {listVersions().length === 0 && <div className="menu__empty">Aún no hay versiones. Use «Guardar».</div>}
              {listVersions().map((v) => (
                <button key={v.id} role="menuitem" onClick={() => (setMenu(null), s.loadModel(v.model, v.templateId, `Versión restaurada: ${v.label}`))}>
                  {v.label}
                  <small>{new Date(v.savedAt).toLocaleString()}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="menu">
          <button className="tool tool--text" aria-haspopup="menu" aria-expanded={menu === 'export'} onClick={() => setMenu(menu === 'export' ? null : 'export')}>
            <Svg d={I.down} /> Exportar
          </button>
          {menu === 'export' && (
            <div className="menu__list menu__list--right" role="menu" onMouseLeave={() => setMenu(null)}>
              <button role="menuitem" onClick={() => download(`${name}.model.json`, JSON.stringify({ model: s.model }, null, 2), 'application/json')}>
                Modelo JSON<small>Editable y re-importable</small>
              </button>
              <button role="menuitem" onClick={() => download(`${name}.mmd`, toMermaid(s.model), 'text/plain')}>
                Mermaid<small>Proyección 2D</small>
              </button>
              <button
                role="menuitem"
                onClick={() =>
                  download(`${name}.md`, toMarkdownReport({ model: s.model, findings: validateModel(s.model), ...(s.result ? { result: s.result } : {}), recommendations: s.recommendations }), 'text/markdown')
                }
              >
                Documento Markdown<small>Componentes, conectividad, simulación</small>
              </button>
              <button role="menuitem" disabled={!s.result} onClick={() => s.result && download(`${name}.${s.result.scenarioId}.simulation.json`, JSON.stringify(s.result, null, 2), 'application/json')}>
                Reporte de simulación (JSON)<small>Eventos reproducibles</small>
              </button>
              <button role="menuitem" onClick={exportPng}>
                PNG de la vista 3D<small>Captura estática</small>
              </button>
              <hr />
              <button role="menuitem" onClick={() => (setMenu(null), s.openImport())}>
                Importar diagrama draw.io…<small>.drawio · .xml · .drawio.svg</small>
              </button>
              <button role="menuitem" onClick={() => fileRef.current?.click()}>
                Importar modelo JSON…<small>Exportado desde esta app</small>
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              setMenu(null);
              if (!f) return;
              if (f.size > 2_000_000) return s.notify('error', 'Archivo demasiado grande (máx. 2 MB).');
              s.importJson(await f.text());
            }}
          />
        </div>
        <button className="tool" onClick={() => s.set({ theme: s.theme === 'dark' ? 'light' : 'dark' })} title="Cambiar tema" aria-label="Cambiar tema">
          <Svg d={s.theme === 'dark' ? I.sun : I.moon} />
        </button>
      </div>
    </header>
  );
}
