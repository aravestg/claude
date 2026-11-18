/**
 * Estilo "Ilustrado": fichas isométricas en tonos pastel con contorno, flechas planas,
 * zonas punteadas y mensajes en píldora. Sólo presentación: el contenido de cada píldora
 * proviene de los datos del evento de simulación.
 */
import { Html, Line, RoundedBox } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Connection, Group, ShapeKind, Vec3 } from '@asa/core-model';
import type { PacketState, VisualStatus } from './derive';
import { Icon } from './icons';
import { STATUS_COLOR } from './palette';

export const INK = { light: '#2f2a24', dark: '#cbd5e1' } as const;

const PASTEL: Record<string, string> = {
  client: '#cfd8e6',
  network: '#bfe3ea',
  edge: '#bfe3ea',
  security: '#f6cfa4',
  integration: '#dccff3',
  compute: '#c4d6f6',
  data: '#f4dc93'
};
const SHAPE_PASTEL: Partial<Record<ShapeKind, string>> = { function: '#cfe8a8', database: '#c4e1ef', nosql: '#f4dc93' };

export function pastelFor(category: string, shape: ShapeKind): string {
  return SHAPE_PASTEL[shape] ?? PASTEL[category] ?? '#d9d4ca';
}

function bodyColor(base: string, status: VisualStatus): string {
  if (status === 'down') return '#d4d0c8';
  if (status === 'error') return '#f5b7b1';
  if (status === 'ok') return new THREE.Color(base).lerp(new THREE.Color('#bfe6b0'), 0.45).getStyle();
  return base;
}

function outlineColor(status: VisualStatus, selected: boolean, theme: 'dark' | 'light'): string {
  if (selected) return '#2563eb';
  if (status === 'idle' || status === 'down' || status === 'ok') return INK[theme];
  return STATUS_COLOR[status];
}

/** Altura de la cara superior de cada forma (para ubicar ícono/etiquetas). */
export function topOf(shape: ShapeKind): number {
  switch (shape) {
    case 'database':
    case 'nosql':
      return 1.25;
    case 'server':
    case 'gateway':
    case 'function':
    case 'distributor':
      return 0.75;
    default:
      return 0.4;
  }
}

/**
 * Contorno tipo "inverted hull": una copia algo mayor, sólo caras traseras, en tinta oscura.
 * Funciona igual con cámara ortográfica o en perspectiva.
 */
function Inked({ children, fill, ink, w = 0.08, position, rotation }: {
  children: React.ReactNode;
  fill: string;
  ink: string;
  w?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
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

function InkedRounded({ args, fill, ink, w = 0.06, position }: { args: [number, number, number]; fill: string; ink: string; w?: number; position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={args} radius={0.16} smoothness={3}>
        <meshLambertMaterial color={fill} />
      </RoundedBox>
      <RoundedBox args={[args[0] + w * 2, args[1] + w * 2, args[2] + w * 2]} radius={0.2} smoothness={3} raycast={() => null}>
        <meshBasicMaterial color={ink} side={THREE.BackSide} />
      </RoundedBox>
    </group>
  );
}

export function IllustratedBody({ shape, base, status, selected, theme }: { shape: ShapeKind; base: string; status: VisualStatus; selected: boolean; theme: 'dark' | 'light' }) {
  const fill = bodyColor(base, status);
  const ink = outlineColor(status, selected, theme);
  const lit = (status !== 'idle' && status !== 'ok') || selected;
  const w = lit ? 0.09 : 0.055;
  const hex = (h: number, r = 1.2) => (
    <Inked fill={fill} ink={ink} w={w} position={[0, h / 2, 0]} rotation={[0, Math.PI / 6, 0]}>
      <cylinderGeometry args={[r, r, h, 6]} />
    </Inked>
  );
  const slab = (h = 0.4, wd = 2.3, d = 2.3) => <InkedRounded args={[wd, h, d]} fill={fill} ink={ink} w={w * 1.6} position={[0, h / 2, 0]} />;
  switch (shape) {
    case 'database':
    case 'nosql':
      return (
        <Inked fill={fill} ink={ink} w={w} position={[0, 0.62, 0]}>
          <cylinderGeometry args={[0.95, 0.95, 1.25, shape === 'nosql' ? 6 : 40]} />
        </Inked>
      );
    case 'server':
    case 'gateway':
    case 'function':
      return hex(0.75);
    case 'distributor':
      return hex(0.75, 1.1);
    case 'device':
      // plataforma con figuritas de usuarios
      return (
        <group>
          {slab(0.3, 2.4, 2.4)}
          {(
            [
              [-0.55, -0.35, '#f2a65a'],
              [0.05, 0.25, '#7cb2e8'],
              [0.6, -0.3, '#9bcf7a']
            ] as const
          ).map(([x, z, c]) => (
            <group key={x} position={[x, 0.3, z]}>
              <Inked fill={c} ink={INK[theme]} w={0.14} position={[0, 0.32, 0]}>
                <capsuleGeometry args={[0.17, 0.32, 4, 12]} />
              </Inked>
              <Inked fill="#f1d7b8" ink={INK[theme]} w={0.14} position={[0, 0.8, 0]}>
                <sphereGeometry args={[0.15, 16, 12]} />
              </Inked>
            </group>
          ))}
        </group>
      );
    case 'wall':
      return (
        <group>
          {slab(0.3)}
          {[-0.6, 0, 0.6].map((z) => (
            <Inked key={z} fill={fill} ink={ink} w={0.1} position={[0, 0.68, z]}>
              <boxGeometry args={[0.4, 0.75, 0.5]} />
            </Inked>
          ))}
        </group>
      );
    default:
      return slab();
  }
}

/** Ícono + nombre impresos sobre la cara superior (como una ficha). */
export function TopFace({ shape, name, theme }: { shape: ShapeKind; name: string; theme: 'dark' | 'light' }) {
  if (shape === 'device' || shape === 'wall') return null;
  return (
    <Html transform position={[0, topOf(shape) + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={0.55} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`ill-face ill-face--${theme}`} aria-hidden title={name}>
        <Icon shape={shape} size={64} />
      </div>
    </Html>
  );
}

export function NamePill({ shape, name, type, status, badge, selected, connectSource, theme, id }: {
  shape: ShapeKind;
  name: string;
  type: string;
  status: VisualStatus;
  badge: string | undefined;
  selected: boolean;
  connectSource: boolean;
  theme: 'dark' | 'light';
  id: string;
}) {
  const statusText = badge ?? (status === 'down' ? '✕ Caído' : status === 'error' ? '✕ Error' : status === 'waiting' ? '⏳ Esperando' : undefined);
  return (
    <>
      <Html position={[0, 0, 1.75]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`ill-pill ill-pill--${theme}${selected ? ' ill-pill--selected' : ''}${connectSource ? ' ill-pill--source' : ''}`} data-component-label={id} title={type}>
          <Icon shape={shape} size={13} />
          <span>{name}</span>
          {statusText && <span className="sr-only"> — {statusText}</span>}
        </div>
      </Html>
      {statusText && (
        <Html position={[0, topOf(shape) + 1.05, 0]} center zIndexRange={[14, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`ill-badge ill-badge--${status}`} aria-hidden>
            {statusText}
          </div>
        </Html>
      )}
    </>
  );
}

const RADIUS = 1.45;

export function flatEnds(a: Vec3, b: Vec3, lane: number): { start: THREE.Vector3; end: THREE.Vector3 } {
  const s = new THREE.Vector3(a.x, 0.32, a.z);
  const e = new THREE.Vector3(b.x, 0.32, b.z);
  const dir = e.clone().sub(s).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(lane * 0.45);
  const len = s.distanceTo(e);
  const trim = Math.min(RADIUS, len / 3);
  return { start: s.clone().add(dir.clone().multiplyScalar(trim)).add(side), end: e.clone().sub(dir.clone().multiplyScalar(trim + 0.1)).add(side) };
}

export function IllustratedConnection(p: { conn: Connection; from: Vec3; to: Vec3; lane: number; status: VisualStatus | undefined; selected: boolean; theme: 'dark' | 'light'; onSelect: () => void }) {
  const { start, end } = useMemo(() => flatEnds(p.from, p.to, p.lane), [p.from, p.to, p.lane]);
  const dir = end.clone().sub(start).normalize();
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), [dir.x, dir.z]);
  const color = p.selected ? '#2563eb' : p.status ? STATUS_COLOR[p.status] : INK[p.theme];
  const mid = start.clone().lerp(end, 0.5);
  const hit = useMemo(() => {
    const len = start.distanceTo(end);
    return { len, angle: Math.atan2(dir.x, dir.z) };
  }, [start, end, dir.x, dir.z]);
  return (
    <group>
      <Line points={[start, end]} color={color} lineWidth={p.status || p.selected ? 4 : 2.6} dashed={!p.conn.props.encrypted} dashSize={0.3} gapSize={0.22} />
      <mesh position={end} quaternion={q}>
        <coneGeometry args={[0.2, 0.5, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={mid} rotation={[0, hit.angle, 0]} visible={false} onClick={(e) => (e.stopPropagation(), p.onSelect())}>
        <boxGeometry args={[0.6, 0.5, hit.len]} />
      </mesh>
      {(p.status || p.selected) && (
      <Html position={[mid.x, 0.4, mid.z]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`ill-proto ill-proto--${p.theme}${p.status ? ` ill-proto--${p.status}` : ''}`}>
          {p.conn.protocol}:{p.conn.port}
          {p.conn.props.encrypted ? ' 🔒' : ''}
        </div>
      </Html>
      )}
    </group>
  );
}

export function IllustratedPacket({ conn, from, to, lane, packet }: { conn: Connection; from: Vec3; to: Vec3; lane: number; packet: PacketState }) {
  const { start, end } = flatEnds(from, to, lane);
  const forward = packet.fromId === conn.sourceId;
  const t = Math.min(1, Math.max(0, forward ? packet.progress : 1 - packet.progress));
  const at = start.clone().lerp(end, t);
  const color = STATUS_COLOR[packet.variant === 'rst' || packet.variant === 'error' ? 'error' : packet.variant === 'response' ? 'ok' : 'active'];
  return (
    <group>
      <mesh position={[at.x, 0.45, at.z]}>
        <sphereGeometry args={[0.2, 18, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={[at.x, 0.5, at.z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`ill-msg ill-msg--${packet.variant}`} data-testid="packet-caption">
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
  const color = group.kind === 'vpc' ? '#4b8fd1' : group.kind === 'subnet' ? (group.props.public ? '#4f9d5d' : '#8a6cc7') : '#c28a2c';
  const y = 0.01 + (group.parentId ? 0.01 : 0);
  const pts = [new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0, y, z0)];
  return (
    <group>
      <mesh position={[(x0 + x1) / 2, y - 0.005, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
        <meshBasicMaterial color={color} transparent opacity={theme === 'light' ? 0.06 : 0.08} depthWrite={false} />
      </mesh>
      <Line points={pts} color={color} lineWidth={2} dashed dashSize={0.4} gapSize={0.25} />
      <Html position={[x0, 0.05, z0]} zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
        <div className="ill-zone" style={{ color, borderColor: color }}>
          {group.name}
          {group.props.cidr ? ` · ${group.props.cidr}` : ''}
        </div>
      </Html>
    </group>
  );
}
