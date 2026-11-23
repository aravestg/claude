/**
 * Disposición automática "por flujo" (presentación pura): capas de izquierda a derecha según el
 * recorrido del tráfico desde los clientes, orden dentro de cada capa por baricentro de sus
 * predecesores para reducir cruces. Determinista. No altera la semántica del modelo.
 */
import { getDefinition, hasDefinition } from './catalog';
import type { ArchitectureModel, Vec3 } from './types';

export interface FlowLayoutOptions {
  layerGap?: number;
  rowGap?: number;
}

export function flowLayout(model: ArchitectureModel, opts: FlowLayoutOptions = {}): Record<string, Vec3> {
  const layerGap = opts.layerGap ?? 6.5;
  const rowGap = opts.rowGap ?? 4.6;
  const ids = model.components.map((c) => c.id);
  const beh = (id: string) => {
    const c = model.components.find((x) => x.id === id)!;
    return hasDefinition(c.type) ? getDefinition(c.type).behavior : 'service';
  };
  const traffic = model.connections.filter((k) => k.protocol !== 'DNS');
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const k of [...traffic].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
    out.set(k.sourceId, [...(out.get(k.sourceId) ?? []), k.targetId]);
    inn.set(k.targetId, [...(inn.get(k.targetId) ?? []), k.sourceId]);
  }
  const dnsIds = ids.filter((id) => beh(id) === 'dns');
  const flowIds = ids.filter((id) => !dnsIds.includes(id));

  // capa = distancia BFS desde los clientes (o desde nodos sin entrada)
  const layer = new Map<string, number>();
  const sources = flowIds.filter((id) => beh(id) === 'client');
  const roots = sources.length ? sources : flowIds.filter((id) => !(inn.get(id) ?? []).length);
  const queue = [...roots];
  roots.forEach((r) => layer.set(r, 0));
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nx of out.get(cur) ?? []) {
      if (!layer.has(nx) && !dnsIds.includes(nx)) {
        layer.set(nx, layer.get(cur)! + 1);
        queue.push(nx);
      }
    }
  }
  // no alcanzados: a la derecha de su predecesor más profundo, o al final
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of flowIds) {
      if (layer.has(id)) continue;
      const preds = (inn.get(id) ?? []).filter((p) => layer.has(p));
      if (preds.length) {
        layer.set(id, Math.max(...preds.map((p) => layer.get(p)!)) + 1);
        changed = true;
      }
    }
  }
  const maxLayer = Math.max(0, ...layer.values());
  const orphans = flowIds.filter((id) => !layer.has(id));
  orphans.forEach((id) => layer.set(id, maxLayer + 1));

  // orden dentro de la capa: baricentro de predecesores (dos pasadas)
  const byLayer = new Map<number, string[]>();
  for (const id of flowIds) byLayer.set(layer.get(id)!, [...(byLayer.get(layer.get(id)!) ?? []), id]);
  const order = new Map<string, number>();
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const l of layers) byLayer.get(l)!.forEach((id, i) => order.set(id, i));
  for (let pass = 0; pass < 2; pass++) {
    for (const l of layers) {
      const list = byLayer.get(l)!;
      const bc = (id: string) => {
        const ps = (inn.get(id) ?? []).filter((p) => layer.get(p)! < l);
        return ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : order.get(id)!;
      };
      list.sort((a, b) => bc(a) - bc(b) || a.localeCompare(b));
      list.forEach((id, i) => order.set(id, i));
    }
  }

  const pos: Record<string, Vec3> = {};
  for (const l of layers) {
    const list = byLayer.get(l)!;
    list.forEach((id, i) => (pos[id] = { x: l * layerGap, y: 0, z: (i - (list.length - 1) / 2) * rowGap }));
  }
  // DNS: junto (arriba) al primer cliente que lo consulta
  dnsIds.forEach((d, i) => {
    const client = model.connections.find((k) => k.targetId === d && k.protocol === 'DNS')?.sourceId;
    const base = client && pos[client] ? pos[client] : { x: 0, y: 0, z: 0 };
    pos[d] = { x: base.x + layerGap * 0.5, y: 0, z: base.z - rowGap * 1.3 - i * rowGap };
  });
  // centrar en el origen
  const xs = Object.values(pos).map((p) => p.x);
  const zs = Object.values(pos).map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  for (const id of Object.keys(pos)) pos[id] = { x: Math.round((pos[id]!.x - cx) * 2) / 2, y: 0, z: Math.round((pos[id]!.z - cz) * 2) / 2 };
  return pos;
}
