/**
 * Capa única de etiquetas DOM sobre la escena 3D.
 * Reemplaza a `Html` de drei (que crea una raíz React por etiqueta y falla al desmontar muchas a
 * la vez con React 19). Aquí las etiquetas se renderizan en el árbol React normal y un proyector
 * dentro del lienzo sólo actualiza `transform` en cada cuadro: menos raíces, mejor rendimiento.
 */
import { useFrame } from '@react-three/fiber';
import { createContext, useContext, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';

interface Entry {
  node: ReactNode;
  obj: THREE.Object3D;
  center: boolean;
  z: number;
}

export class LabelRegistry {
  private entries = new Map<string, Entry>();
  readonly els = new Map<string, HTMLDivElement>();
  private listeners = new Set<() => void>();
  private snapshot: [string, Entry][] = [];
  private pending = false;

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
}

export const LabelContext = createContext<LabelRegistry | null>(null);

/** Sustituto de `<Html>`: misma forma de uso (position, center); el resto de props se ignora. */
export function Label({ position = [0, 0, 0], center = true, children, z = 0 }: { position?: [number, number, number] | THREE.Vector3Tuple; center?: boolean; children: ReactNode; z?: number; [k: string]: unknown }) {
  const reg = useContext(LabelContext);
  const id = useId();
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (reg && ref.current) reg.set(id, { node: children, obj: ref.current, center, z });
  });
  useLayoutEffect(() => () => reg?.delete(id), [reg, id]);
  return <group ref={ref} position={position as [number, number, number]} />;
}

export function LabelProjector({ registry }: { registry: LabelRegistry }) {
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera, size }) => {
    for (const [id, e] of registry.list()) {
      const el = registry.els.get(id);
      if (!el) continue;
      e.obj.getWorldPosition(v.current).project(camera);
      if (v.current.z > 1 || v.current.z < -1) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = '';
      const x = ((v.current.x + 1) / 2) * size.width;
      const y = ((1 - v.current.y) / 2) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${e.center ? ' translate(-50%, -50%)' : ''}`;
      el.style.zIndex = String(Math.round((1 - v.current.z) * 500) + e.z);
    }
  });
  return null;
}

export function LabelLayer({ registry }: { registry: LabelRegistry }) {
  const entries = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return (
    <div className="asa-label-layer" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {entries.map(([id, e]) => (
        <div
          key={id}
          ref={(el) => {
            if (el) registry.els.set(id, el);
            else registry.els.delete(id);
          }}
          style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', willChange: 'transform' }}
        >
          {e.node}
        </div>
      ))}
    </div>
  );
}
