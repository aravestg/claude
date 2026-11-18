import { useMemo, useState } from 'react';
import { compatibleProtocols, defaultPortFor, nextId } from '@asa/core-model';
import type { LayerKey } from '@asa/visualization-3d';
import { ArchitectureCanvas, deriveSceneState, STATUS_COLOR } from '@asa/visualization-3d';
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

      <div className="overlay overlay--tl" role="toolbar" aria-label="Herramientas">
        <div className="seg">
          <button className={s.tool === 'select' ? 'on' : ''} onClick={() => s.setTool('select')} title="Seleccionar / mover (V)">
            ⬚ Seleccionar
          </button>
          <button className={s.tool === 'connect' ? 'on' : ''} onClick={() => s.setTool('connect')} title="Crear conexión: origen y luego destino (C)">
            ⟶ Conectar
          </button>
        </div>
        {s.tool === 'connect' && <div className="hint">{s.connectFrom ? 'Elija el componente destino' : 'Elija el componente origen'} · Esc para cancelar</div>}
      </div>

      <div className="overlay overlay--tr" role="toolbar" aria-label="Cámara y capas">
        <div className="seg">
          {(
            [
              ['perspective', 'Perspectiva'],
              ['top', 'Superior'],
              ['side', 'Lateral'],
              ['iso', 'Isométrica'],
              ['focus', 'Enfocar']
            ] as const
          ).map(([v, l]) => (
            <button key={v} onClick={() => s.setCamera(v)} title={v === 'focus' ? 'Enfocar selección (F)' : `Vista ${l.toLowerCase()}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={s.follow ? 'on' : ''} onClick={() => s.set({ follow: !s.follow })} aria-pressed={s.follow} title="La cámara acompaña la solicitud activa">
            ◎ Seguir solicitud
          </button>
          <button onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>
            ☰ Capas
          </button>
          <button onClick={() => s.set({ quality: s.quality === 'high' ? 'low' : 'high' })} title="Calidad gráfica (no altera la simulación)">
            {s.quality === 'high' ? 'Alta' : 'Baja'}
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
      </div>

      <div className="overlay overlay--bl legend" aria-label="Leyenda">
        {(
          [
            ['active', '→ Solicitud / activo'],
            ['ok', '✔ Éxito'],
            ['warning', '⏳ Espera / reintento'],
            ['error', '✖ Error / bloqueo'],
            ['down', '⬇ Caído']
          ] as const
        ).map(([k, l]) => (
          <span key={k}>
            <i style={{ background: STATUS_COLOR[k] }} />
            {l}
          </span>
        ))}
        <span>
          <i className="dash" />
          Sin cifrado
        </span>
      </div>

      <div className="overlay overlay--br provenance" title="Principio P6: transparencia">
        <strong>Simulación basada en reglas</strong> · latencias estimadas · no es medición real
        {s.runtime && <span className="muted"> · motor en {s.runtime}</span>}
      </div>

      {stale && (
        <div className="overlay overlay--tc stale" role="status">
          El modelo cambió desde la última simulación.{' '}
          <button className="link" onClick={() => void s.simulate()}>
            Volver a simular
          </button>
        </div>
      )}
    </section>
  );
}
