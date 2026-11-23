/**
 * Capa única de etiquetas DOM sobre la escena 3D, con ubicación anti-colisión.
 *
 * - Una sola raíz React (reemplaza `Html` de drei).
 * - En cada cuadro: se proyectan las anclas, se ubican las etiquetas por PRIORIDAD (críticas primero)
 *   evitando superponerse entre sí y con las fichas 3D de otros componentes (obstáculos). Si una
 *   etiqueta no cabe en ninguna posición alternativa, se oculta (reaparece al acercar el zoom).
 *   Las etiquetas críticas (prioridad ≥ CRITICAL) siempre se muestran.
 */
import { useFrame } from '@react-three/fiber';
import { createContext, useContext, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';

export const CRITICAL = 40;

interface Entry {
  node: ReactNode;
  obj: THREE.Object3D;
  center: boolean;
  z: number;
  alt: boolean;
  owner?: string;
}
interface Obstacle {
  obj: THREE.Object3D;
  radius: number;
  owner: string;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  owner?: string;
}

export class LabelRegistry {
  private entries = new Map<string, Entry>();
  readonly obstacles = new Map<string, Obstacle>();
  readonly els = new Map<string, HTMLDivElement>();
  readonly sizes = new Map<string, { w: number; h: number }>();
  layer: HTMLDivElement | null = null;
  private lod = '';
  private listeners = new Set<() => void>();
  private snapshot: [string, Entry][] = [];
  private pending = false;
  readonly observer: ResizeObserver | null =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((items) => {
          for (const it of items) {
            const id = (it.target as HTMLElement).dataset['labelId'];
            if (id) this.sizes.set(id, { w: (it.target as HTMLElement).offsetWidth, h: (it.target as HTMLElement).offsetHeight });
          }
        })
      : null;

  set(id: string, e: Entry) {
    this.entries.set(id, e);
    this.notify();
  }
  delete(id: string) {
    if (this.entries.delete(id)) this.notify();
  }
  private notify() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.snapshot = [...this.entries];
      for (const l of this.listeners) l();
    });
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snapshot;
  list() {
    return this.entries;
  }
  setLod(level: string) {
    if (level === this.lod || !this.layer) return;
    this.lod = level;
    this.layer.dataset['lod'] = level;
  }
}

export const LabelContext = createContext<LabelRegistry | null>(null);

/**
 * Sustituto de `<Html>`. `z` = prioridad (mayor se ubica primero). `alt` permite posiciones
 * alternativas si la principal colisiona. `owner` = componente al que pertenece (su propia ficha
 * no cuenta como obstáculo).
 */
export function Label({
  position = [0, 0, 0],
  center = true,
  children,
  z = 10,
  alt = true,
  owner
}: {
  position?: [number, number, number] | THREE.Vector3Tuple;
  center?: boolean;
  children: ReactNode;
  z?: number;
  alt?: boolean;
  owner?: string;
  [k: string]: unknown;
}) {
  const reg = useContext(LabelContext);
  const id = useId();
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (reg && ref.current) reg.set(id, { node: children, obj: ref.current, center, z, alt, ...(owner ? { owner } : {}) });
  });
  useLayoutEffect(() => () => reg?.delete(id), [reg, id]);
  return <group ref={ref} position={position as [number, number, number]} />;
}

/** Huella en pantalla de la ficha 3D de un componente (otras etiquetas la evitan). */
export function LabelObstacle({ owner, radius = 1.5, position = [0, 0.6, 0] }: { owner: string; radius?: number; position?: [number, number, number] }) {
  const reg = useContext(LabelContext);
  const id = useId();
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (reg && ref.current) reg.obstacles.set(id, { obj: ref.current, radius, owner });
    return () => void reg?.obstacles.delete(id);
  }, [reg, id, radius, owner]);
  return <group ref={ref} position={position} />;
}

const overlaps = (a: Rect, b: Rect, pad = 3) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export function LabelProjector({ registry }: { registry: LabelRegistry }) {
  const v = useRef(new THREE.Vector3());
  const v2 = useRef(new THREE.Vector3());
  useFrame(({ camera, size }) => {
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    registry.setLod(!ortho ? 'near' : camera.zoom < 9 ? 'far' : camera.zoom < 20 ? 'mid' : 'near');
    const toScreen = (p: THREE.Vector3) => ({ x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height, z: p.z });

    // obstáculos: fichas 3D proyectadas
    const placed: Rect[] = [];
    for (const o of registry.obstacles.values()) {
      o.obj.getWorldPosition(v.current);
      v2.current.copy(v.current).add(new THREE.Vector3(o.radius, 0, 0));
      const c = toScreen(v.current.project(camera));
      const e = toScreen(v2.current.project(camera));
      const r = Math.max(6, Math.hypot(e.x - c.x, e.y - c.y));
      placed.push({ x: c.x - r * 0.95, y: c.y - r * 0.75, w: r * 1.9, h: r * 1.35, owner: o.owner });
    }

    const items = [...registry.list()].map(([id, e]) => {
      e.obj.getWorldPosition(v.current).project(camera);
      return { id, e, s: toScreen(v.current), size: registry.sizes.get(id) };
    });
    items.sort((a, b) => b.e.z - a.e.z || a.s.z - b.s.z);

    let forced = 0;
    for (const it of items) {
      const el = registry.els.get(it.id);
      if (!el) continue;
      if (it.s.z > 1 || it.s.z < -1) {
        el.style.visibility = 'hidden';
        continue;
      }
      const w = it.size?.w ?? 0;
      const h = it.size?.h ?? 0;
      const baseX = it.e.center ? it.s.x - w / 2 : it.s.x;
      const baseY = it.e.center ? it.s.y - h / 2 : it.s.y;
      const cands: [number, number][] = it.e.alt
        ? [[0, 0], [0, h * 0.75 + 6], [0, -(h * 0.75 + 6)], [w * 0.55 + 6, 0], [-(w * 0.55 + 6), 0], [0, h * 1.6 + 10], [0, -(h * 1.6 + 10)]]
        : [[0, 0]];
      if (it.e.alt && it.e.z >= CRITICAL) {
        const dx = w * 0.55 + 10;
        const dy = h * 0.9 + 8;
        cands.push([dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy], [0, -(h * 2.6 + 14)], [0, h * 2.6 + 14], [w + 16, 0], [-(w + 16), 0]);
      }
      let chosen: [number, number] | null = null;
      for (const [dx, dy] of cands) {
        const r: Rect = { x: baseX + dx, y: baseY + dy, w, h };
        const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= size.width && r.y + r.h <= size.height;
        if (inside && !placed.some((p) => (p.owner === undefined || p.owner !== it.e.owner) && overlaps(r, p))) {
          chosen = [dx, dy];
          break;
        }
      }
      if (!chosen && it.e.z >= CRITICAL) {
        chosen = [0, 0];
        forced++;
      }
      if (!chosen || !w) {
        el.style.visibility = w ? 'hidden' : 'hidden';
        if (!w) el.style.transform = `translate3d(${baseX.toFixed(1)}px, ${baseY.toFixed(1)}px, 0)`;
        continue;
      }
      const x = baseX + chosen[0];
      const y = baseY + chosen[1];
      // línea guía hacia el ancla cuando la etiqueta tuvo que desplazarse
      const leader = el.firstElementChild as HTMLElement | null;
      if (leader?.classList.contains('asa-leader')) {
        const moved = chosen[0] !== 0 || chosen[1] !== 0;
        if (moved) {
          const cx = x + w / 2;
          const cy = y + h / 2;
          const ax = it.s.x;
          const ay = it.s.y;
          const len = Math.hypot(ax - cx, ay - cy);
          leader.style.display = 'block';
          leader.style.width = `${len.toFixed(1)}px`;
          leader.style.left = `${(w / 2).toFixed(1)}px`;
          leader.style.top = `${(h / 2).toFixed(1)}px`;
          leader.style.transform = `rotate(${Math.atan2(ay - cy, ax - cx)}rad)`;
        } else leader.style.display = 'none';
      }
      placed.push({ x, y, w, h, ...(it.e.owner ? { owner: `label:${it.e.owner}` } : {}) });
      el.style.visibility = '';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.zIndex = String(100 + it.e.z);
    }
    // métrica observable (E2E): etiquetas críticas que no encontraron hueco libre
    if (registry.layer && registry.layer.dataset['forced'] !== String(forced)) registry.layer.dataset['forced'] = String(forced);
  });
  return null;
}

export function LabelLayer({ registry }: { registry: LabelRegistry }) {
  const entries = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return (
    <div className="asa-label-layer" ref={(el) => void (registry.layer = el)} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {entries.map(([id, e]) => (
        <div
          key={id}
          data-label-id={id}
          ref={(el) => {
            if (el) {
              registry.els.set(id, el);
              registry.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
              registry.observer?.observe(el);
            } else {
              const old = registry.els.get(id);
              if (old) registry.observer?.unobserve(old);
              registry.els.delete(id);
              registry.sizes.delete(id);
            }
          }}
          style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', willChange: 'transform', width: 'max-content' }}
        >
          <span className="asa-leader" aria-hidden />
          {e.node}
        </div>
      ))}
    </div>
  );
}
