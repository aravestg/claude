import { useMemo, useState } from 'react';
import { compatibleProtocols, defaultPortFor, nextId } from '@asa/core-model';
import type { LayerKey } from '@asa/visualization-3d';
import { ArchitectureCanvas, deriveSceneState } from '@asa/visualization-3d';
import { useStudio } from '../store';

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'infrastructure', label: 'Infraestructura (VPC/subredes)' },
  { key: 'network', label: 'Redes' },
  { key: 'application', label: 'Aplicaciones' },
  { key: 'integration', label: 'Integraciones' },
  { key: 'data', label: 'Datos' },
  { key: 'security', label: 'Seguridad' },
  { key: 'communications', label: 'Comunicaciones' },
  { key: 'failures', label: 'Fallas (insignias)' }
];

export function Viewport() {
  const s = useStudio();
  const [layersOpen, setLayersOpen] = useState(false);
  const sceneState = useMemo(() => (s.result ? deriveSceneState(s.result.events, s.cursor, s.progress) : { components: {}, connections: {} }), [s.result, s.cursor, s.progress]);
  const stale = s.result && s.resultRevision !== s.model.revision;

  const connect = (targetId: string) => {
    const from = s.pickConnect(targetId);
    if (!from) {
      if (s.connectFrom === null) s.notify('info', 'Origen seleccionado. Ahora elija el destino.');
      return;
    }
    const src = s.model.components.find((c) => c.id === from)!;
    const dst = s.model.components.find((c) => c.id === targetId)!;
    const protos = compatibleProtocols(src.type, dst.type);
    if (!protos.length) return s.notify('error', `${dst.name} no acepta conexiones desde ${src.name} con ningún protocolo compatible.`);
    const protocol = protos[0]!;
    const id = nextId(s.model, 'conn');
    s.apply(
      [{ op: 'add_connection', connection: { id, sourceId: from, targetId, protocol, port: defaultPortFor(dst.type, protocol) ?? 443, props: { latencyMs: 2, encrypted: protocol === 'HTTPS' || protocol === 'JDBC' } } }],
      `Conexión ${src.name} → ${dst.name} (${protocol}) creada.`
    );
    s.select({ kind: 'connection', id });
  };

  return (
    <section className="viewport" aria-label="Escena 3D" data-testid="scene">
      <ArchitectureCanvas
        key={s.model.id}
        model={s.model}
        sceneState={sceneState}
        selection={s.selection}
        hiddenLayers={s.hiddenLayers}
        tool={s.tool}
        connectFrom={s.connectFrom}
        follow={s.follow}
        camera={s.camera}
        theme={s.theme}
        quality={s.quality}
        visualStyle={s.visualStyle}
        onSelect={(sel) => {
          if (s.tool === 'connect' && !sel) s.setTool('select');
          s.select(sel);
        }}
        onMove={(id, position) => s.apply([{ op: 'move_component', componentId: id, position }])}
        onConnectPick={connect}
        onFocus={(id) => {
          s.select({ kind: 'component', id });
          s.setCamera('focus');
        }}
      />

      <div className="canvas-tools" role="toolbar" aria-label="Herramientas de la escena">
        <div className="seg">
          <button className={s.tool === 'select' ? 'on' : ''} onClick={() => s.setTool('select')} title="Seleccionar / mover (V)">
            ⬚ Mover
          </button>
          <button className={s.tool === 'connect' ? 'on' : ''} onClick={() => s.setTool('connect')} title="Crear conexión: origen y luego destino (C)">
            ⟶ Conectar
          </button>
        </div>
        <div className="seg">
          {(
            [
              ['perspective', 'Iso'],
              ['front', 'Frente'],
              ['top', 'Planta'],
              ['side', 'Lateral'],
              ['focus', 'Enfocar']
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => s.setCamera(v)} title={v === 'focus' ? 'Enfocar selección (F)' : `Vista: ${l.toLowerCase()}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={s.follow ? 'on' : ''} onClick={() => s.set({ follow: !s.follow })} aria-pressed={s.follow} title="La cámara acompaña la solicitud activa">
            ◎ Seguir
          </button>
          <button onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>
            ☰ Capas
          </button>
          <button
            onClick={() => {
              s.set({ visualStyle: s.visualStyle === 'illustrated' ? 'classic' : 'illustrated' });
              s.setCamera('perspective');
            }}
            title="Estilo visual (no altera la simulación)"
            data-testid="style-toggle"
          >
            {s.visualStyle === 'illustrated' ? '✎ Ilustrado' : '◼ Realista'}
          </button>
        </div>
        {layersOpen && (
          <div className="layers" role="group" aria-label="Capas visibles">
            {LAYERS.map((l) => (
              <label key={l.key}>
                <input type="checkbox" checked={!s.hiddenLayers.has(l.key)} onChange={() => s.toggleLayer(l.key)} /> {l.label}
              </label>
            ))}
            <p className="muted small">Ocultar una capa no elimina información del modelo.</p>
          </div>
        )}
        {s.tool === 'connect' && <div className="hint">{s.connectFrom ? 'Elija el destino' : 'Elija el origen'} · Esc cancela</div>}
      </div>

      <div className="legend" aria-label="Leyenda">
        <span><i className="lg lg--req" />solicitud</span>
        <span><i className="lg lg--resp" />respuesta</span>
        <span><i className="lg lg--hs" />handshake</span>
        <span><i className="lg lg--fail" />falla</span>
        <span><i className="lg lg--async" />asíncrono</span>
        <span><i className="lg lg--dash" />sin cifrado</span>
      </div>

      {stale && (
        <div className="stale" role="status">
          El modelo cambió desde la última simulación.{' '}
          <button className="link" onClick={() => void s.simulate()}>
            Volver a simular
          </button>
        </div>
      )}
    </section>
  );
}
