/**
 * Estilo "Ilustrado" (inspirado en diagramas isométricos editoriales): hexágonos redondeados con
 * contorno de tinta, cilindros, plataformas con multitudes, líneas finas y puntos de color que
 * viajan. Sólo presentación: textos y estados provienen de los eventos de simulación.
 */
import { Edges, Html, Line, RoundedBox } from '@react-three/drei';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import type { Connection, Group, ShapeKind, Vec3 } from '@asa/core-model';
import type { PacketState, VisualStatus } from './derive';
import { Icon } from './icons';

export const INK = { light: '#1d1b18', dark: '#e2e8f0' } as const;

/** Colores de cara (tonos de la referencia). */
const FACE: Partial<Record<ShapeKind, string>> = {
  distributor: '#f7c9a0',
  server: '#c9dcf4',
  function: '#d4e9b9',
  gateway: '#dfd3f4',
  database: '#dcd1f3',
  nosql: '#f6dc93',
  dns: '#f8da8c',
  globe: '#cbeadf',
  wall: '#f4c3b2',
  device: '#efe6d8',
  bucket: '#d3e6f3'
};

const STATUS_INK: Record<VisualStatus, string | null> = {
  idle: null,
  ok: null,
  active: '#2f6fdf',
  warning: '#c98a0b',
  waiting: '#c98a0b',
  error: '#c0392b',
  down: null
};

export function faceColor(shape: ShapeKind, status: VisualStatus): string {
  if (status === 'down') return '#d6d1c8';
  if (status === 'error') return '#f3b5ab';
  return FACE[shape] ?? '#e7dfd2';
}

/** Altura de la cara superior (ubicación de etiquetas). */
export function topOf(shape: ShapeKind): number {
  switch (shape) {
    case 'database':
    case 'nosql':
      return 1.5;
    case 'server':
    case 'gateway':
    case 'function':
    case 'distributor':
    case 'globe':
    case 'dns':
      return 1.05;
    case 'wall':
      return 1.1;
    default:
      return 0.35;
  }
}

/** Formas con etiqueta impresa en la cara (el resto lleva píldora debajo). */
export function hasFaceLabel(shape: ShapeKind): boolean {
  return !['device', 'wall'].includes(shape);
}

function roundedHexShape(r: number, corner: number): THREE.Shape {
  const shape = new THREE.Shape();
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  for (let i = 0; i < 6; i++) {
    const p = pts[i]!;
    const prev = pts[(i + 5) % 6]!;
    const next = pts[(i + 1) % 6]!;
    const a = p.clone().lerp(prev, corner);
    const b = p.clone().lerp(next, corner);
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function hexGeometry(r: number, h: number): THREE.BufferGeometry {
  const key = `${r}:${h}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.ExtrudeGeometry(roundedHexShape(r, 0.16), { depth: h, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    geoCache.set(key, g);
  }
  return g;
}

function roundedRect(w: number, d: number, r: number, y: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, Math.PI / 2],
    [-w / 2 + r, -d / 2 + r, Math.PI],
    [w / 2 - r, -d / 2 + r, (3 * Math.PI) / 2]
  ];
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= 6; i++) {
    const a = a0 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r));
  }
  pts.push(pts[0]!.clone());
  return pts;
}

function Inked({ children, fill, ink, w, position }: { children: ReactNode; fill: string; ink: string; w: number; position?: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        {children}
        <meshLambertMaterial color={fill} />
      </mesh>
      <mesh scale={1 + w} raycast={() => null}>
        {children}
        <meshBasicMaterial color={ink} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

/** Casco radial (sólo X/Z) para la silueta: evita la franja oscura sobre la cara superior. */
function Silhouette({ geometry, children, ink, w }: { geometry?: THREE.BufferGeometry; children?: ReactNode; ink: string; w: number }) {
  return (
    <mesh geometry={geometry} scale={[1 + w, 1, 1 + w]} raycast={() => null}>
      {children}
      <meshBasicMaterial color={ink} side={THREE.BackSide} />
    </mesh>
  );
}

function Hex({ r, h, fill, ink, lw }: { r: number; h: number; fill: string; ink: string; lw: number }) {
  const g = hexGeometry(r, h);
  return (
    <group>
      <mesh geometry={g}>
        <meshLambertMaterial color={fill} />
        <Edges threshold={35} lineWidth={lw > 0.09 ? 2.6 : 1.9} color={ink} />
      </mesh>
      <Silhouette geometry={g} ink={ink} w={lw * 0.55} />
    </group>
  );
}

function Slab({ w, d, h, fill, ink, lw }: { w: number; d: number; h: number; fill: string; ink: string; lw: number }) {
  const top = useMemo(() => roundedRect(w, d, 0.22, h + 0.003), [w, d, h]);
  return (
    <group>
      <group position={[0, h / 2, 0]}>
        <RoundedBox args={[w, h, d]} radius={0.12} smoothness={3}>
          <meshLambertMaterial color={fill} />
        </RoundedBox>
        <RoundedBox args={[w + lw * 2, h, d + lw * 2]} radius={0.12} smoothness={3} raycast={() => null}>
          <meshBasicMaterial color={ink} side={THREE.BackSide} />
        </RoundedBox>
      </group>
      <Line points={top} color={ink} lineWidth={lw > 0.09 ? 2.4 : 1.8} />
    </group>
  );
}

const CROWD = ['#d9c9f2', '#c4d8f5', '#f5c99a', '#c8e3ad', '#f5c99a', '#d9c9f2', '#c4d8f5', '#c8e3ad', '#d9c9f2'];

export function IllustratedBody({ shape, status, selected, theme }: { shape: ShapeKind; status: VisualStatus; selected: boolean; theme: 'dark' | 'light' }) {
  const fill = faceColor(shape, status);
  const ink = selected ? '#2f6fdf' : (STATUS_INK[status] ?? INK[theme]);
  const lw = selected || STATUS_INK[status] ? 0.12 : 0.08;
  switch (shape) {
    case 'server':
    case 'gateway':
    case 'function':
    case 'distributor':
    case 'globe':
    case 'dns':
      return <Hex r={shape === 'distributor' ? 1.45 : 1.35} h={1.05} fill={fill} ink={ink} lw={lw} />;
    case 'database':
    case 'nosql':
      return (
        <group position={[0, 0.75, 0]}>
          <mesh>
            <cylinderGeometry args={[1.05, 1.05, 1.5, shape === 'nosql' ? 6 : 48]} />
            <meshLambertMaterial color={fill} />
            <Edges threshold={35} lineWidth={lw > 0.09 ? 2.6 : 1.9} color={ink} />
          </mesh>
          <Silhouette ink={ink} w={lw * 0.5}>
            <cylinderGeometry args={[1.05, 1.05, 1.5, shape === 'nosql' ? 6 : 48]} />
          </Silhouette>
        </group>
      );
    case 'device':
      // plataforma con una multitud (usuarios)
      return (
        <group>
          <Slab w={3} d={3} h={0.35} fill={fill} ink={ink} lw={lw} />
          {CROWD.map((c, i) => {
            const x = (i % 3) * 0.8 - 0.8;
            const z = Math.floor(i / 3) * 0.8 - 0.8;
            return (
              <group key={i} position={[x, 0.35, z]}>
                <Inked fill={c} ink={INK[theme]} w={0.16} position={[0, 0.3, 0]}>
                  <capsuleGeometry args={[0.15, 0.28, 4, 12]} />
                </Inked>
                <Inked fill="#fbf6ee" ink={INK[theme]} w={0.16} position={[0, 0.74, 0]}>
                  <sphereGeometry args={[0.14, 16, 12]} />
                </Inked>
              </group>
            );
          })}
        </group>
      );
    case 'wall':
      return (
        <group>
          <Slab w={2.6} d={2.6} h={0.3} fill="#efe6d8" ink={INK[theme]} lw={0.05} />
          {[-0.75, 0, 0.75].map((z) => (
            <mesh key={z} position={[0, 0.72, z]}>
              <boxGeometry args={[0.5, 0.85, 0.62]} />
              <meshLambertMaterial color={fill} />
              <Edges threshold={30} lineWidth={1.8} color={ink} />
            </mesh>
          ))}
        </group>
      );
    default:
      return <Slab w={2.4} d={2.4} h={0.4} fill={fill} ink={ink} lw={lw} />;
  }
}

/** Ícono y nombre "impresos" sobre la ficha (alineados a pantalla, como en la referencia). */
export function FaceLabel({ shape, name, id, status, theme }: { shape: ShapeKind; name: string; id: string; status: VisualStatus; theme: 'dark' | 'light' }) {
  const clean = name.replace(/\s*\(.*\)\s*/, ' ').trim();
  const words = clean.length > 8 ? clean.split(/\s+/) : [clean];
  return (
    <Html position={[0, topOf(shape) + 0.02, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`ill-face ill-face--${theme} ill-face--${status}`} data-component-label={id} style={{ ['--halo' as string]: faceColor(shape, status) }}>
        <Icon shape={shape} size={22} />
        <span>{words.length > 2 ? `${words[0]}\n${words.slice(1).join(' ')}` : words.join('\n')}</span>
      </div>
    </Html>
  );
}

export function NamePill({ shape, name, id, selected, connectSource, theme }: { shape: ShapeKind; name: string; id: string; selected: boolean; connectSource: boolean; theme: 'dark' | 'light' }) {
  return (
    <Html position={[0, 0, 2.15]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`ill-pill ill-pill--${theme}${selected ? ' ill-pill--selected' : ''}${connectSource ? ' ill-pill--source' : ''}`} data-component-label={id}>
        <Icon shape={shape} size={14} />
        <span>{name}</span>
      </div>
    </Html>
  );
}

export function StatusBadge({ shape, status, badge }: { shape: ShapeKind; status: VisualStatus; badge: string | undefined }) {
  const text = badge ?? (status === 'down' ? '✕ Caído' : status === 'error' ? '✕ Error' : status === 'waiting' ? '⏳ Esperando' : undefined);
  if (!text) return null;
  return (
    <Html position={[0, topOf(shape) + 0.9, 0]} center zIndexRange={[14, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`ill-badge ill-badge--${status}`} data-status-badge>
        {text}
      </div>
    </Html>
  );
}

const RADIUS = 1.75;

export function flatEnds(a: Vec3, b: Vec3, lane: number): { start: THREE.Vector3; end: THREE.Vector3 } {
  const s = new THREE.Vector3(a.x, 0.55, a.z);
  const e = new THREE.Vector3(b.x, 0.55, b.z);
  const dir = e.clone().sub(s).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(lane * 0.5);
  const len = s.distanceTo(e);
  const trim = Math.min(RADIUS, len / 3);
  return { start: s.clone().add(dir.clone().multiplyScalar(trim)).add(side), end: e.clone().sub(dir.clone().multiplyScalar(trim + 0.12)).add(side) };
}

export function IllustratedConnection(p: { conn: Connection; from: Vec3; to: Vec3; lane: number; status: VisualStatus | undefined; selected: boolean; theme: 'dark' | 'light'; onSelect: () => void }) {
  const { start, end } = useMemo(() => flatEnds(p.from, p.to, p.lane), [p.from, p.to, p.lane]);
  const dir = end.clone().sub(start).normalize();
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), [dir.x, dir.z]);
  const failed = p.status === 'error';
  const color = p.selected ? '#2f6fdf' : failed ? '#c0392b' : INK[p.theme];
  const len = start.distanceTo(end);
  const mid = start.clone().lerp(end, 0.5);
  return (
    <group>
      <Line points={[start, end]} color={color} lineWidth={p.selected || failed ? 2.6 : p.status ? 2 : 1.5} dashed={!p.conn.props.encrypted} dashSize={0.32} gapSize={0.22} transparent opacity={p.status || p.selected ? 1 : 0.75} />
      <mesh position={end} quaternion={q}>
        <coneGeometry args={[0.15, 0.42, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={mid} rotation={[0, Math.atan2(dir.x, dir.z), 0]} visible={false} onClick={(e) => (e.stopPropagation(), p.onSelect())}>
        <boxGeometry args={[0.7, 0.6, len]} />
      </mesh>
      {p.selected && (
        <Html position={[mid.x, 0.6, mid.z]} center zIndexRange={[16, 0]} style={{ pointerEvents: 'none' }}>
          <div className="ill-note">
            {p.conn.protocol}:{p.conn.port}
            {p.conn.props.encrypted ? ' · TLS' : ' · sin cifrado'}
          </div>
        </Html>
      )}
    </group>
  );
}

const DOT: Record<PacketState['variant'], string> = {
  request: '#e9955e',
  syn: '#e9955e',
  dns: '#e9955e',
  query: '#e9955e',
  response: '#7fc278',
  rst: '#c0392b',
  error: '#c0392b'
};

export function IllustratedPacket({ conn, from, to, lane, packet, theme }: { conn: Connection; from: Vec3; to: Vec3; lane: number; packet: PacketState; theme: 'dark' | 'light' }) {
  const { start, end } = flatEnds(from, to, lane);
  const forward = packet.fromId === conn.sourceId;
  const t = Math.min(1, Math.max(0, forward ? packet.progress : 1 - packet.progress));
  const at = start.clone().lerp(end, t);
  const mid = start.clone().lerp(end, 0.5);
  const dir = end.clone().sub(start).normalize();
  // la anotación va del lado "alto" de la pantalla (alejado de la cámara isométrica)
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  if (side.x + side.z > 0) side.negate();
  side.multiplyScalar(1.15);
  const notePos = mid.clone().add(side);
  const color = DOT[packet.variant];
  const hollow = packet.variant === 'syn';
  return (
    <group>
      {hollow ? (
        <mesh position={[at.x, 0.62, at.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.06, 10, 24]} />
          <meshBasicMaterial color="#3fa456" />
        </mesh>
      ) : (
        <Inked fill={color} ink={INK[theme]} w={0.28} position={[at.x, 0.62, at.z]}>
          <sphereGeometry args={[0.17, 18, 12]} />
        </Inked>
      )}
      <Html position={[notePos.x, 0.6, notePos.z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`ill-note ill-note--${packet.variant}`} data-testid="packet-caption">
          {packet.caption}
        </div>
      </Html>
    </group>
  );
}

export function IllustratedZone({ group, min, max, pad, theme }: { group: Group; min: Vec3; max: Vec3; pad: number; theme: 'dark' | 'light' }) {
  const x0 = min.x - pad;
  const x1 = max.x + pad;
  const z0 = min.z - pad;
  const z1 = max.z + pad;
  const color = theme === 'light' ? (group.kind === 'vpc' ? '#a99e8e' : '#c6bbac') : '#475569';
  const y = 0.012 + (group.parentId ? 0.006 : 0);
  const pts = [new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0, y, z0)];
  return (
    <group>
      <mesh position={[(x0 + x1) / 2, y - 0.004, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
        <meshBasicMaterial color={theme === 'light' ? '#efe4d4' : '#1e293b'} transparent opacity={group.parentId ? 0.45 : 0.35} depthWrite={false} />
      </mesh>
      <Line points={pts} color={color} lineWidth={1.4} dashed dashSize={0.35} gapSize={0.25} />
      {!group.parentId && (
      <Html position={[x0, 0.05, z0]} zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
        <div className="ill-zone">
          {group.name}
          {group.props.cidr ? ` · ${group.props.cidr}` : ''}
        </div>
      </Html>
      )}
    </group>
  );
}
