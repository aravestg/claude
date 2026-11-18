import { useRef, useState } from 'react';
import { TEMPLATES, toMarkdownReport, toMermaid, validateModel } from '@asa/core-model';
import { download, slug } from '../download';
import { listVersions, saveVersion } from '../persistence';
import { useStudio } from '../store';

export function TopBar() {
  const s = useStudio();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<'export' | 'versions' | null>(null);
  const scenario = s.scenarios.find((x) => x.id === s.scenarioId);
  const name = slug(s.model.name);

  const exportPng = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="scene"] canvas');
    if (!canvas) return s.notify('error', 'No se encontró el lienzo 3D.');
    canvas.toBlob((b) => b && download(`${name}-vista3d.png`, b));
  };

  return (
    <header className="topbar" role="banner">
      <div className="brand">
        <span className="brand__logo" aria-hidden>◆</span>
        <div>
          <div className="brand__name">Architecture Studio AI</div>
          <div className="brand__project" title={s.model.description}>
            {s.model.name} · rev.{s.model.revision}
          </div>
        </div>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Acciones del proyecto">
        <label className="field-inline">
          <span className="sr-only">Plantilla</span>
          <select
            value={s.templateId}
            onChange={(e) => {
              if (s.past.length && !confirm('¿Cargar la plantilla? Los cambios quedan en el historial (Ctrl+Z).')) return;
              s.loadTemplate(e.target.value);
            }}
            aria-label="Plantilla"
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button className="icon-btn" onClick={s.undo} disabled={!s.past.length} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
          ↶
        </button>
        <button className="icon-btn" onClick={s.redo} disabled={!s.future.length} title="Rehacer (Ctrl+Shift+Z)" aria-label="Rehacer">
          ↷
        </button>
        <button className="btn" onClick={() => s.set({ rightTab: 'validation' })} title="Validar el modelo">
          Validar
        </button>
        <button
          className="btn"
          onClick={() => {
            const v = saveVersion(s.templateId, s.model, `${s.model.name} · rev.${s.model.revision}`);
            s.notify(v ? 'success' : 'error', v ? 'Versión guardada en este navegador.' : 'No se pudo guardar (almacenamiento no disponible).');
          }}
          title="Guardar versión"
        >
          Guardar
        </button>
        <div className="menu">
          <button className="btn" aria-haspopup="menu" aria-expanded={menu === 'versions'} onClick={() => setMenu(menu === 'versions' ? null : 'versions')}>
            Versiones ▾
          </button>
          {menu === 'versions' && (
            <div className="menu__list" role="menu" onMouseLeave={() => setMenu(null)}>
              {listVersions().length === 0 && <div className="menu__empty">Aún no hay versiones guardadas. Use «Guardar».</div>}
              {listVersions().map((v) => (
                <button
                  key={v.id}
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    s.loadModel(v.model, v.templateId, `Versión restaurada: ${v.label}`);
                  }}
                >
                  {v.label}
                  <small>{new Date(v.savedAt).toLocaleString()}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="menu">
          <button className="btn" aria-haspopup="menu" aria-expanded={menu === 'export'} onClick={() => setMenu(menu === 'export' ? null : 'export')}>
            Exportar ▾
          </button>
          {menu === 'export' && (
            <div className="menu__list" role="menu" onMouseLeave={() => setMenu(null)}>
              <button role="menuitem" onClick={() => download(`${name}.model.json`, JSON.stringify({ model: s.model }, null, 2), 'application/json')}>
                Modelo JSON<small>Editable y re-importable</small>
              </button>
              <button role="menuitem" onClick={() => download(`${name}.mmd`, toMermaid(s.model), 'text/plain')}>
                Mermaid<small>Proyección 2D</small>
              </button>
              <button
                role="menuitem"
                onClick={() =>
                  download(
                    `${name}.md`,
                    toMarkdownReport({ model: s.model, findings: validateModel(s.model), ...(s.result ? { result: s.result } : {}), recommendations: s.recommendations }),
                    'text/markdown'
                  )
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
              <button role="menuitem" onClick={() => fileRef.current?.click()}>
                Importar modelo JSON…
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
      </div>

      <div className="toolbar toolbar--sim" role="toolbar" aria-label="Simulación">
        <label className="field-inline">
          <span className="sr-only">Escenario</span>
          <select value={s.scenarioId} onChange={(e) => s.setScenario(e.target.value)} aria-label="Escenario" data-testid="scenario-select">
            {s.scenarios.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        {scenario?.setup?.length ? (
          <button className="btn btn--warn" onClick={s.prepareScenario} title="Aplica al modelo la configuración que requiere el escenario (con confirmación)">
            Aplicar configuración
          </button>
        ) : null}
        <button className="btn btn--primary" onClick={() => void s.simulate()} disabled={s.running} data-testid="run-simulation">
          {s.running ? 'Simulando…' : '▶ Simular'}
        </button>
        <button className="icon-btn" onClick={() => s.set({ theme: s.theme === 'dark' ? 'light' : 'dark' })} title="Cambiar tema" aria-label="Cambiar tema">
          {s.theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
