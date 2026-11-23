/**
 * 3D Visualization Engine. Recibe el modelo (topología y layout) y un SceneState derivado de
 * eventos de simulación. NO evalúa reglas: sólo dibuja lo que los eventos dicen que pasó.
 */
import { Grid, Line, OrbitControls } from '@react-three/drei';
import { Label, LabelContext, LabelLayer, LabelProjector, LabelRegistry } from './labels';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ArchitectureModel, Connection, Group, Vec3 } from '@asa/core-model';
import { getDefinition, hasDefinition } from '@asa/core-model';
import type { SceneState, VisualStatus } from './derive';
import { bounds, connectionCurve } from './geometry';
import { CATEGORY_COLOR, PACKET_COLOR, STATUS_COLOR, STATUS_LABEL } from './palette';
import { Shape } from './shapes';
import { FaceLabel, hasFaceLabel, IllustratedBody, IllustratedConnection, IllustratedPacket, IllustratedZone, NamePill, StatusBadge } from './illustrated';
import type { CameraRequest, LayerKey, Selection, Tool, VisualStyle } from './types';

export interface ArchitectureCanvasProps {
  model: ArchitectureModel;
  sceneState: SceneState;
  selection: Selection;
  hiddenLayers: ReadonlySet<LayerKey>;
  tool: Tool;
  connectFrom: string | null;
  follow: boolean;
  camera: CameraRequest;
  theme: 'dark' | 'light';
  quality: 'high' | 'low';
  visualStyle: VisualStyle;
  onSelect: (sel: Selection) => void;
  onMove: (id: string, pos: Vec3) => void;
  onConnectPick: (id: string) => void;
  onFocus: (id: string) => void;
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

export function ArchitectureCanvas(props: ArchitectureCanvasProps) {
  const ill = props.visualStyle === 'illustrated';
  const bg = props.theme === 'dark' ? (ill ? '#16140f' : '#0b1120') : ill ? '#f6efe5' : '#eef2f7';
  const registry = useMemo(() => new LabelRegistry(), []);
  return (
    <LabelContext.Provider value={registry}>
    <div className="asa-stage" style={{ position: 'relative', width: '100%', height: '100%' }}>
    <Canvas
      key={props.visualStyle}
      orthographic={ill}
      flat={ill}
      shadows={!ill && props.quality === 'high'}
      dpr={props.quality === 'high' ? [1, 2] : 1}
      camera={ill ? { position: [40, 38, 40], zoom: 34, near: -500, far: 1000 } : { position: [-6, 16, 24], fov: 45, near: 0.1, far: 500 }}
      gl={{ preserveDrawingBuffer: true, antialias: props.quality === 'high' }}
      onPointerMissed={() => props.onSelect(null)}
      data-testid="scene-canvas"
    >
      <color attach="background" args={[bg]} />
      {!ill && <fog attach="fog" args={[bg, 45, 110]} />}
      <hemisphereLight args={['#dbeafe', ill ? '#b8a98c' : '#1e293b', ill ? 1.1 : 0.6]} />
      <ambientLight intensity={ill ? 0.9 : 0.35} />
      <directionalLight
        position={[12, 22, 10]}
        intensity={ill ? 0.9 : 1.25}
        castShadow={!ill && props.quality === 'high'}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <SceneContent {...props} />
      <LabelProjector registry={registry} />
    </Canvas>
    <LabelLayer registry={registry} />
    </div>
    </LabelContext.Provider>
  );
}

function SceneContent(props: ArchitectureCanvasProps) {
  const { model, sceneState, hiddenLayers, theme } = props;
  const ill = props.visualStyle === 'illustrated';
  const [dragPreview, setDragPreview] = useState<{ id: string; pos: Vec3 } | null>(null);
  const pos = (id: string): Vec3 => (dragPreview?.id === id ? dragPreview.pos : (model.layout.positions[id] ?? ORIGIN));

  const visible = useMemo(() => {
    const s = new Set<string>();
    for (const c of model.components) {
      const layer = hasDefinition(c.type) ? getDefinition(c.type).layer : 'application';
      if (!hiddenLayers.has(layer)) s.add(c.id);
    }
    return s;
  }, [model.components, hiddenLayers]);

  // carriles para conexiones paralelas entre el mismo par
  const lanes = useMemo(() => {
    const m = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const k of model.connections) {
      const key = [k.sourceId, k.targetId].sort().join('|');
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      m.set(k.id, n === 0 ? 0 : n % 2 ? 1 : -1);
    }
    return m;
  }, [model.connections]);

  return (
    <>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.05} minDistance={4} maxDistance={120} minZoom={6} maxZoom={220} />
      <CameraRig {...props} pos={pos} />
      <Grid
        position={[0, -0.01, 0]}
        args={[200, 200]}
        cellSize={1}
        sectionSize={5}
        cellColor={theme === 'dark' ? (ill ? '#2a2620' : '#1e293b') : ill ? '#e8ded1' : '#cbd5e1'}
        sectionColor={theme === 'dark' ? (ill ? '#3a342c' : '#334155') : ill ? '#e1d6c7' : '#94a3b8'}
        fadeDistance={90}
        infiniteGrid
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <shadowMaterial transparent opacity={theme === 'dark' ? 0.35 : 0.15} />
      </mesh>

      {!hiddenLayers.has('groups') &&
        !hiddenLayers.has('infrastructure') &&
        model.groups.map((g) => <GroupBox key={g.id} group={g} model={model} pos={pos} visible={visible} theme={theme} illustrated={ill} />)}

      {!hiddenLayers.has('communications') &&
        model.connections
          .filter((k) => visible.has(k.sourceId) && visible.has(k.targetId))
          .map((k) =>
            ill ? (
              <IllustratedConnection
                key={k.id}
                conn={k}
                from={pos(k.sourceId)}
                to={pos(k.targetId)}
                lane={lanes.get(k.id) ?? 0}
                status={sceneState.connections[k.id]?.status}
                selected={props.selection?.kind === 'connection' && props.selection.id === k.id}
                theme={theme}
                onSelect={() => props.onSelect({ kind: 'connection', id: k.id })}
              />
            ) : (
            <ConnectionView
              key={k.id}
              conn={k}
              from={pos(k.sourceId)}
              to={pos(k.targetId)}
              lane={lanes.get(k.id) ?? 0}
              status={sceneState.connections[k.id]?.status}
              selected={props.selection?.kind === 'connection' && props.selection.id === k.id}
              theme={theme}
              onSelect={() => props.onSelect({ kind: 'connection', id: k.id })}
            />
            )
          )}

      {model.components
        .filter((c) => visible.has(c.id))
        .map((c) => (
          <ComponentNode
            key={c.id}
            id={c.id}
            name={c.name}
            type={c.type}
            position={pos(c.id)}
            status={sceneState.components[c.id]?.status ?? 'idle'}
            badge={hiddenLayers.has('failures') ? undefined : sceneState.components[c.id]?.badge}
            focused={sceneState.focusId === c.id}
            selected={props.selection?.kind === 'component' && props.selection.id === c.id}
            connectSource={props.connectFrom === c.id}
            tool={props.tool}
            theme={theme}
            illustrated={ill}
            onSelect={() => (props.tool === 'connect' ? props.onConnectPick(c.id) : props.onSelect({ kind: 'component', id: c.id }))}
            onDoubleClick={() => props.onFocus(c.id)}
            onDrag={(p) => setDragPreview(p ? { id: c.id, pos: p } : null)}
            onDrop={(p) => {
              setDragPreview(null);
              props.onMove(c.id, p);
            }}
          />
        ))}

      {!hiddenLayers.has('communications') && sceneState.packet && (() => {
        const k = model.connections.find((x) => x.id === sceneState.packet!.connectionId);
        if (!k || !visible.has(k.sourceId) || !visible.has(k.targetId)) return null;
        if (ill) return <IllustratedPacket conn={k} from={pos(k.sourceId)} to={pos(k.targetId)} lane={lanes.get(k.id) ?? 0} packet={sceneState.packet!} theme={theme} />;
        return <PacketView conn={k} from={pos(k.sourceId)} to={pos(k.targetId)} lane={lanes.get(k.id) ?? 0} packet={sceneState.packet!} />;
      })()}
    </>
  );
}

// ---------------------------------------------------------------------------

function ComponentNode(p: {
  id: string;
  name: string;
  type: string;
  position: Vec3;
  status: VisualStatus;
  badge: string | undefined;
  focused: boolean;
  selected: boolean;
  connectSource: boolean;
  tool: Tool;
  theme: 'dark' | 'light';
  illustrated: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onDrag: (p: Vec3 | null) => void;
  onDrop: (p: Vec3) => void;
}) {
  const def = hasDefinition(p.type) ? getDefinition(p.type) : undefined;
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const drag = useRef<{ start: THREE.Vector3; moved: boolean } | null>(null);
  const ring = useRef<THREE.Mesh>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const [hover, setHover] = useState(false);

  const statusColor = STATUS_COLOR[p.status];
  const base = CATEGORY_COLOR[def?.category ?? 'compute'] ?? '#6366f1';
  const lit = p.status !== 'idle';
  const color = p.status === 'down' ? '#4b5563' : base;
  const emissive = lit && p.status !== 'down' ? statusColor : '#000000';

  useFrame(({ clock }) => {
    if (!ring.current) return;
    // pulso = indicador de estado activo derivado de un evento (no decorativo)
    const pulse = p.status === 'active' || p.status === 'waiting' || p.focused ? 1 + Math.sin(clock.elapsedTime * 5) * 0.08 : 1;
    ring.current.scale.setScalar(pulse);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (p.tool !== 'select') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.ray.intersectPlane(plane, hit);
    drag.current = { start: hit.clone(), moved: false };
    if (controls) controls.enabled = false;
  };
  const onMoveEvt = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(plane, hit)) return;
    if (!drag.current.moved && hit.distanceTo(drag.current.start) < 0.15) return;
    drag.current.moved = true;
    p.onDrag({ x: Math.round(hit.x * 2) / 2, y: 0, z: Math.round(hit.z * 2) / 2 });
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    e.stopPropagation();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
    const moved = drag.current.moved;
    drag.current = null;
    if (moved && e.ray.intersectPlane(plane, hit)) p.onDrop({ x: Math.round(hit.x * 2) / 2, y: 0, z: Math.round(hit.z * 2) / 2 });
    else p.onDrag(null);
  };

  return (
    <group position={[p.position.x, 0, p.position.z]}>
      <group
        onPointerDown={onDown}
        onPointerMove={onMoveEvt}
        onPointerUp={onUp}
        onClick={(e) => {
          e.stopPropagation();
          p.onSelect();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          p.onDoubleClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = p.tool === 'connect' ? 'crosshair' : 'grab';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
        userData={{ componentId: p.id }}
      >
        {p.illustrated ? (
          <IllustratedBody shape={def?.shape ?? 'server'} status={p.status} selected={p.selected || p.connectSource || hover} theme={p.theme} />
        ) : (
          <Shape shape={def?.shape ?? 'server'} color={color} emissive={emissive} emissiveIntensity={lit ? 0.55 : 0} opacity={p.status === 'down' ? 0.55 : 1} />
        )}
        {/* volumen de selección */}
        <mesh position={[0, 0.9, 0]} visible={false}>
          <boxGeometry args={[1.8, 1.9, 1.8]} />
        </mesh>
      </group>
      {p.illustrated && (
        <>
          {hasFaceLabel(def?.shape ?? 'server') ? (
            <FaceLabel shape={def?.shape ?? 'server'} name={p.name} id={p.id} status={p.status} theme={p.theme} />
          ) : (
            <NamePill shape={def?.shape ?? 'server'} name={p.name} id={p.id} selected={p.selected} connectSource={p.connectSource} theme={p.theme} />
          )}
          <StatusBadge shape={def?.shape ?? 'server'} status={p.status} badge={p.badge} />
        </>
      )}
      {!p.illustrated && (
      <>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[1.05, p.selected || p.connectSource ? 1.3 : 1.18, 48]} />
        <meshBasicMaterial
          color={p.connectSource ? '#a855f7' : p.selected ? '#f8fafc' : lit ? statusColor : p.theme === 'dark' ? '#334155' : '#94a3b8'}
          transparent
          opacity={lit || p.selected || hover ? 0.95 : 0.6}
        />
      </mesh>
      <Label position={[0, 2.35, 0]} center distanceFactor={20} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`asa-label asa-label--${p.status}${p.selected ? ' asa-label--selected' : ''}`} data-component-label={p.id}>
          <div className="asa-label__name">{p.name}</div>
          <div className="asa-label__type">{def?.label ?? p.type}</div>
          {(p.badge || STATUS_LABEL[p.status]) && <div className="asa-label__status">{p.badge ?? STATUS_LABEL[p.status]}</div>}
        </div>
      </Label>
      </>
      )}
    </group>
  );
}

function ConnectionView(p: {
  conn: Connection;
  from: Vec3;
  to: Vec3;
  lane: number;
  status: VisualStatus | undefined;
  selected: boolean;
  theme: 'dark' | 'light';
  onSelect: () => void;
}) {
  const curve = useMemo(() => connectionCurve(p.from, p.to, p.lane), [p.from, p.to, p.lane]);
  const points = useMemo(() => curve.getPoints(40), [curve]);
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 24, 0.22, 6, false), [curve]);
  useEffect(() => () => tube.dispose(), [tube]);
  const arrow = useMemo(() => {
    const t = 0.82;
    const at = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    return { at, q };
  }, [curve]);
  const idle = p.theme === 'dark' ? '#475569' : '#94a3b8';
  const color = p.selected ? '#f8fafc' : p.status ? STATUS_COLOR[p.status] : idle;
  const mid = curve.getPoint(0.5);
  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={p.status ? 3 : 1.6}
        dashed={!p.conn.props.encrypted}
        dashSize={0.35}
        gapSize={0.25}
        transparent
        opacity={p.status ? 1 : 0.8}
      />
      <mesh position={arrow.at} quaternion={arrow.q}>
        <coneGeometry args={[0.13, 0.36, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh
        geometry={tube}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          p.onSelect();
        }}
      />
      <Label position={[mid.x, mid.y + 0.25, mid.z]} center distanceFactor={18} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`asa-conn-label${p.status ? ` asa-conn-label--${p.status}` : ''}`}>
          {p.conn.protocol}:{p.conn.port}
          {p.conn.props.encrypted ? ' 🔒' : ''}
        </div>
      </Label>
    </group>
  );
}

function PacketView(p: { conn: Connection; from: Vec3; to: Vec3; lane: number; packet: NonNullable<SceneState['packet']> }) {
  const curve = useMemo(() => connectionCurve(p.from, p.to, p.lane), [p.from, p.to, p.lane]);
  const forward = p.packet.fromId === p.conn.sourceId;
  const t = forward ? p.packet.progress : 1 - p.packet.progress;
  const color = PACKET_COLOR[p.packet.variant];
  const head = curve.getPoint(Math.min(1, Math.max(0, t)));
  const trail = [0.04, 0.08, 0.12].map((d) => curve.getPoint(Math.min(1, Math.max(0, forward ? t - d : t + d))));
  const size = p.packet.variant === 'syn' || p.packet.variant === 'rst' ? 0.16 : 0.24;
  return (
    <group>
      <mesh position={head}>
        {p.packet.variant === 'syn' || p.packet.variant === 'rst' ? <boxGeometry args={[size * 1.6, size * 1.6, size * 1.6]} /> : <sphereGeometry args={[size, 20, 12]} />}
        <meshBasicMaterial color={color} />
      </mesh>
      <pointLight position={head} color={color} intensity={4} distance={3.5} />
      {trail.map((pt, i) => (
        <mesh key={i} position={pt}>
          <sphereGeometry args={[size * (0.7 - i * 0.18), 10, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.5 - i * 0.14} />
        </mesh>
      ))}
      <Label position={[head.x, head.y + 0.55, head.z]} center distanceFactor={18} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`asa-packet-label asa-packet-label--${p.packet.variant}`}>{p.packet.label || p.packet.variant}</div>
      </Label>
    </group>
  );
}

function GroupBox(p: { group: Group; model: ArchitectureModel; pos: (id: string) => Vec3; visible: Set<string>; theme: 'dark' | 'light'; illustrated: boolean }) {
  const depthBelow = (g: Group): number => {
    const kids = p.model.groups.filter((x) => x.parentId === g.id);
    return kids.length ? 1 + Math.max(...kids.map(depthBelow)) : 0;
  };
  const members = p.group.memberIds.filter((id) => p.visible.has(id));
  if (!members.length) return null;
  const b = bounds(members.map(p.pos));
  const d = depthBelow(p.group);
  const pad = 1.55 + d * 0.75;
  const w = b.max.x - b.min.x + pad * 2;
  const depth = b.max.z - b.min.z + pad * 2;
  const h = 2.6 + d * 0.6;
  const color = p.group.kind === 'vpc' ? '#38bdf8' : p.group.kind === 'subnet' ? (p.group.props.public ? '#22c55e' : '#a78bfa') : '#f59e0b';
  const geo = useMemo(() => new THREE.BoxGeometry(w, h, depth), [w, h, depth]);
  const illustratedZone = p.illustrated ? <IllustratedZone group={p.group} min={b.min} max={b.max} pad={2.6 + d * 0.8} theme={p.theme} /> : null;
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  useEffect(
    () => () => {
      geo.dispose();
      edges.dispose();
    },
    [geo, edges]
  );
  if (illustratedZone) return illustratedZone;
  return (
    <group position={[b.center.x, h / 2 - 0.02, b.center.z]}>
      <mesh geometry={geo} raycast={() => null} renderOrder={-1}>
        <meshStandardMaterial color={color} transparent opacity={p.theme === 'dark' ? 0.05 : 0.07} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.55} />
      </lineSegments>
      <Label position={[-w / 2 + 0.2, h / 2, -depth / 2]} distanceFactor={24} zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
        <div className="asa-group-label" style={{ borderColor: color, color }}>
          {p.group.name}
          {p.group.props.cidr ? ` · ${p.group.props.cidr}` : ''}
        </div>
      </Label>
    </group>
  );
}

function CameraRig(p: ArchitectureCanvasProps & { pos: (id: string) => Vec3 }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const anim = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; zoom?: number; t: number } | null>(null);
  const b = bounds(p.model.components.map((c) => p.model.layout.positions[c.id] ?? ORIGIN));
  const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;

  useEffect(() => {
    const c = new THREE.Vector3(b.center.x, 0, b.center.z);
    const s = b.size;
    let target = c.clone();
    let pos: THREE.Vector3;
    // ortográfica: la distancia no cambia el tamaño; el encuadre lo da el zoom
    const D = ortho ? 60 : s;
    const fitZoom = Math.min(size.width / (s * 1.12), size.height / (s * 0.72));
    let zoom: number | undefined = ortho ? fitZoom : undefined;
    switch (p.camera.view) {
      case 'top':
        pos = new THREE.Vector3(c.x, ortho ? D : s * 1.35, c.z + 0.01);
        if (ortho) zoom = Math.min(size.width / (s * 1.25), size.height / (s * 0.8));
        break;
      case 'side':
        pos = ortho ? new THREE.Vector3(c.x, 6, c.z + D) : new THREE.Vector3(c.x, 4, c.z + s * 1.15);
        break;
      case 'focus': {
        const id = p.selection?.kind === 'component' ? p.selection.id : p.sceneState.focusId;
        if (!id) return;
        const at = p.pos(id);
        target = new THREE.Vector3(at.x, 0.6, at.z);
        pos = ortho ? target.clone().add(new THREE.Vector3(D, D * 0.95, D)) : new THREE.Vector3(at.x + 5, 6, at.z + 8);
        if (ortho) zoom = fitZoom * 2.4;
        break;
      }
      case 'iso':
      case 'perspective':
      default:
        pos = ortho
          ? c.clone().add(new THREE.Vector3(D, D * 0.95, D))
          : p.camera.view === 'iso'
            ? new THREE.Vector3(c.x + s * 0.75, s * 0.75, c.z + s * 0.75)
            : new THREE.Vector3(c.x - s * 0.2, s * 0.55, c.z + s * 0.85);
    }
    if (ortho && p.camera.view !== 'focus') {
      // Encuadre exacto: proyecta los componentes desde la orientación final y ajusta zoom y centro
      // al área libre (descontando métricas arriba y leyenda/herramientas abajo).
      const cam = (camera as THREE.OrthographicCamera).clone();
      cam.position.copy(pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.zoom = 1;
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const pts = p.model.components.flatMap((c) => {
        const q = p.model.layout.positions[c.id] ?? ORIGIN;
        return [
          [q.x - 1.8, 0, q.z - 1.8],
          [q.x + 1.8, 0, q.z + 1.8],
          [q.x - 1.8, 2.6, q.z + 1.8],
          [q.x + 1.8, 2.6, q.z - 1.8],
          [q.x, 0, q.z + 2.6]
        ] as const;
      });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y, z] of pts) {
        const v = new THREE.Vector3(x, y, z).project(cam);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      if (Number.isFinite(x0)) {
        const top = 84, bottom = 46, side = 24;
        const ex = ((x1 - x0) * size.width) / 2;
        const ey = ((y1 - y0) * size.height) / 2;
        zoom = Math.max(6, Math.min((size.width - side * 2) / ex, (size.height - top - bottom) / ey, 80));
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        const cx = (((x0 + x1) / 2) * size.width) / 2;
        const cy = (((y0 + y1) / 2) * size.height) / 2;
        const delta = right.multiplyScalar(cx).add(up.multiplyScalar(cy + (top - bottom) / 2 / zoom));
        target.add(delta);
        pos.add(delta);
      }
    }
    anim.current = zoom !== undefined ? { pos, target, zoom, t: 0 } : { pos, target, t: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.camera.nonce, ortho]);

  useFrame((_, dt) => {
    if (!controls) return;
    if (anim.current) {
      const a = anim.current;
      a.t = Math.min(1, a.t + dt * 2.2);
      const k = 1 - Math.pow(1 - a.t, 3);
      camera.position.lerp(a.pos, k);
      controls.target.lerp(a.target, k);
      if (ortho && a.zoom) {
        camera.zoom += (a.zoom - camera.zoom) * k;
        camera.updateProjectionMatrix();
      }
      controls.update();
      if (a.t >= 1) anim.current = null;
      return;
    }
    if (p.follow && p.sceneState.focusId) {
      // seguimiento de la solicitud: el objetivo sigue al componente/paquete activo
      const at = p.pos(p.sceneState.focusId);
      const goal = new THREE.Vector3(at.x, 0.6, at.z);
      if (p.sceneState.packet) {
        const k = p.model.connections.find((x) => x.id === p.sceneState.packet!.connectionId);
        if (k) {
          const a = p.pos(k.sourceId);
          const z = p.pos(k.targetId);
          const fwd = p.sceneState.packet.fromId === k.sourceId;
          const t = fwd ? p.sceneState.packet.progress : 1 - p.sceneState.packet.progress;
          goal.set(a.x + (z.x - a.x) * t, 0.6, a.z + (z.z - a.z) * t);
        }
      }
      const delta = goal.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
      controls.target.add(delta);
      camera.position.add(delta);
      controls.update();
    }
  });
  return null;
}
