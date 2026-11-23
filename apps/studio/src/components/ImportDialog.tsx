/**
 * Importación de draw.io con revisión: el usuario ve qué se detectó, corrige tipos y confirma.
 * Nada llega al modelo sin confirmación (principio P5).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DrawioAnalysis, DrawioImportResult, DrawioPage } from '@asa/core-model';
import { analyzeDrawioPage, buildFromAnalysis, getDefinition, listDefinitions, readDrawio } from '@asa/core-model';
import { inflateRawBrowser, isDrawioName, MAX_DRAWIO_FILE } from '../drawio';
import { IMPORTED, useStudio } from '../store';

type Phase = 'pick' | 'reading' | 'review' | 'done' | 'error';

export function ImportDialog() {
  const s = useStudio();
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [pages, setPages] = useState<DrawioPage[]>([]);
  const [pageId, setPageId] = useState('');
  const [analysis, setAnalysis] = useState<DrawioAnalysis | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [done, setDone] = useState<DrawioImportResult | null>(null);
  const [layout, setLayout] = useState<'flow' | 'original'>('flow');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (s.importOpen && !d.open) d.showModal();
    if (!s.importOpen && d.open) d.close();
  }, [s.importOpen]);

  useEffect(() => {
    if (s.importOpen && s.importFile) void load(s.importFile);
    if (s.importOpen && !s.importFile) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.importOpen, s.importFile]);

  const reset = () => {
    setPhase('pick');
    setError('');
    setPages([]);
    setAnalysis(null);
    setOverrides({});
    setDone(null);
  };
  const close = () => {
    useStudio.setState({ importOpen: false, importFile: null });
    reset();
  };

  async function load(file: File) {
    reset();
    setFileName(file.name);
    if (!isDrawioName(file.name)) return fail('Formato no soportado. Use un archivo .drawio, .xml o .drawio.svg exportado desde draw.io.');
    if (file.size > MAX_DRAWIO_FILE) return fail('El archivo supera 5 MB.');
    setPhase('reading');
    try {
      const ps = await readDrawio(await file.text(), { inflateRaw: inflateRawBrowser });
      setPages(ps);
      setPageId(ps[0]!.id);
      setAnalysis(analyzeDrawioPage(ps[0]!));
      setPhase('review');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  }
  function fail(msg: string) {
    setError(msg);
    setPhase('error');
  }

  const preview = useMemo(() => {
    if (!analysis) return null;
    try {
      return { ok: true as const, result: buildFromAnalysis(analysis, { overrides, layout, name: fileName.replace(/\.(drawio|xml|svg|dio)$/i, '').replace(/\.drawio$/i, '') || analysis.pageName }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [analysis, overrides, fileName, layout]);

  const defs = useMemo(() => listDefinitions(), []);

  const confirm = () => {
    if (!preview?.ok) return;
    const r = preview.result;
    s.loadModel(r.model, IMPORTED, `Diagrama importado: ${r.model.components.length} componentes, ${r.model.connections.length} conexiones`, r.scenarios);
    // en la disposición por flujo, las zonas del diagrama original no corresponden: se ocultan (reactivables en «Capas»)
    const hidden = new Set(useStudio.getState().hiddenLayers);
    if (layout === 'flow') hidden.add('groups');
    else hidden.delete('groups');
    useStudio.setState({ hiddenLayers: hidden });
    setDone(r);
    setPhase('done');
  };

  return (
    <dialog ref={ref} className="dialog dialog--wide" onCancel={(e) => (e.preventDefault(), close())} aria-labelledby="import-title" data-testid="import-dialog">
      <div className="row row--between">
        <h2 id="import-title">Importar diagrama de draw.io</h2>
        <button className="tool" onClick={close} aria-label="Cerrar">
          ✕
        </button>
      </div>

      {(phase === 'pick' || phase === 'error') && (
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void load(f);
          }}
        >
          <p>
            Arrastre aquí un archivo <code>.drawio</code>, <code>.xml</code> o <code>.drawio.svg</code>, o
          </p>
          <button className="pop pop--green" onClick={() => fileRef.current?.click()}>
            Elegir archivo…
          </button>
          <p className="muted small">
            Se reconocen íconos de AWS, Azure y GCP, figuras genéricas (cilindro, nube, actor) y textos. El archivo se procesa sólo en su navegador: no se envía a ningún servidor.
          </p>
          {phase === 'error' && (
            <p className="error" role="alert">
              {fileName ? `«${fileName}»: ` : ''}
              {error}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".drawio,.xml,.svg,.dio,application/xml,image/svg+xml"
            hidden
            data-testid="import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void load(f);
            }}
          />
        </div>
      )}

      {phase === 'reading' && <p className="muted">Leyendo «{fileName}»…</p>}

      {phase === 'review' && analysis && (
        <>
          <p className="muted small">
            «{fileName}» · revise lo detectado, corrija tipos si es necesario y confirme. Los completados automáticos quedarán registrados como supuestos.
          </p>
          {pages.length > 1 && (
            <label className="field">
              <span>Página</span>
              <select
                value={pageId}
                onChange={(e) => {
                  const p = pages.find((x) => x.id === e.target.value)!;
                  setPageId(p.id);
                  setOverrides({});
                  setAnalysis(analyzeDrawioPage(p));
                }}
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="import-layout">
            <legend>Disposición en 3D</legend>
            <label>
              <input type="radio" name="layout" checked={layout === 'flow'} onChange={() => setLayout('flow')} data-testid="layout-flow" /> Ordenar por flujo de tráfico <small className="muted">(recomendado para simular)</small>
            </label>
            <label>
              <input type="radio" name="layout" checked={layout === 'original'} onChange={() => setLayout('original')} data-testid="layout-original" /> Conservar la del diagrama
            </label>
          </fieldset>
          <div className="import-summary">
            <span className="chip chip--green">{analysis.nodes.length} figuras</span>
            <span className="chip chip--violet">{analysis.groups.length} grupos</span>
            <span className="chip chip--amber">{analysis.edges.length} flechas</span>
            {analysis.skipped.length > 0 && <span className="chip chip--rose">{analysis.skipped.length} omitidos</span>}
          </div>
          <div className="import-table" role="table" aria-label="Componentes detectados">
            <div className="import-row import-row--head" role="row">
              <span>Figura</span>
              <span>Tipo en el modelo</span>
              <span>Confianza</span>
            </div>
            {analysis.nodes.map((n) => {
              const value = overrides[n.cellId] ?? n.type ?? 'compute.app_server';
              return (
                <div className="import-row" role="row" key={n.cellId}>
                  <span>
                    <strong>{n.label || '(sin texto)'}</strong>
                    <small className="muted">{n.styleHint}</small>
                  </span>
                  <select value={value} onChange={(e) => setOverrides({ ...overrides, [n.cellId]: e.target.value })} aria-label={`Tipo para ${n.label || n.cellId}`}>
                    {defs.map((d) => (
                      <option key={d.type} value={d.type}>
                        {d.label}
                      </option>
                    ))}
                    <option value="ignore">— Ignorar —</option>
                  </select>
                  <span className={`conf conf--${overrides[n.cellId] ? 'usuario' : n.confidence}`}>{overrides[n.cellId] ? 'corregido' : `${n.confidence} · ${n.by}`}</span>
                </div>
              );
            })}
          </div>
          {analysis.groups.length > 0 && (
            <p className="small">
              <strong>Grupos:</strong> {analysis.groups.map((g) => `${g.label || g.kind} (${g.kind})`).join(' · ')}
            </p>
          )}
          {preview && !preview.ok && (
            <p className="error" role="alert">
              {preview.error}
            </p>
          )}
          {preview?.ok && (
            <details className="import-details">
              <summary>
                {preview.result.report.connections.length} conexiones · {preview.result.scenarios.length} escenarios · {preview.result.report.warnings.length} advertencias · {preview.result.report.skipped.length} omitidos
              </summary>
              <ul className="list">
                {preview.result.report.connections.map((k) => (
                  <li key={k.id}>
                    {k.from} → {k.to} · {k.protocol}:{k.port}
                    {k.note ? <em className="muted"> ({k.note})</em> : null}
                  </li>
                ))}
                {preview.result.report.warnings.map((w) => (
                  <li key={w} className="warn">
                    ! {w}
                  </li>
                ))}
                {preview.result.report.skipped.map((x) => (
                  <li key={x.cellId} className="muted">
                    ✕ {x.label}: {x.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row row--end">
            <button className="pop" onClick={reset}>
              Elegir otro archivo
            </button>
            <button className="pop pop--green" onClick={confirm} disabled={!preview?.ok} data-testid="import-confirm">
              Importar y abrir en 3D
            </button>
          </div>
        </>
      )}

      {phase === 'done' && done && (
        <>
          <p>
            Se importó <strong>{done.model.name}</strong>: {done.model.components.length} componentes, {done.model.connections.length} conexiones, {done.model.groups.length} grupos y{' '}
            {done.scenarios.length} escenarios generados.
          </p>
          <h3>Supuestos registrados</h3>
          <ul className="list">
            {done.model.assumptions.map((a) => (
              <li key={a}>· {a}</li>
            ))}
          </ul>
          <p className="muted small">Puede ajustar todo en el modo Diseñar. Tipos: {[...new Set(done.model.components.map((c) => getDefinition(c.type).label))].join(', ')}.</p>
          <div className="row row--end">
            <button className="pop" onClick={close}>
              Cerrar
            </button>
            <button
              className="pop pop--green"
              disabled={!done.scenarios.length}
              data-testid="import-simulate"
              onClick={() => {
                close();
                void useStudio.getState().simulate();
              }}
            >
              ▶ Simular flujo principal
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
