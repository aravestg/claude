/**
 * Operaciones estructuradas sobre el modelo. Es la ÚNICA vía de mutación: la usan el editor 3D,
 * las recomendaciones del motor de reglas y (Fase 2) el asistente IA. Aplicación atómica.
 */
import { clone } from './clone';
import { compatibleProtocols, getDefinition, hasDefinition } from './catalog';
import type { ModelOperation } from './contracts';
import { parseOperations } from './schema';
import type { ArchitectureModel } from './types';

export type ApplyResult = { ok: true; model: ArchitectureModel } | { ok: false; errors: string[] };

export function applyOperations(model: ArchitectureModel, operations: ModelOperation[]): ApplyResult {
  const parsed = parseOperations(operations);
  if (!parsed.ok) return parsed;
  const next = clone(model);
  const errors: string[] = [];
  for (const [i, op] of parsed.value.entries()) {
    const err = applyOne(next, op);
    if (err) errors.push(`op[${i}] ${op.op}: ${err}`);
  }
  if (errors.length) return { ok: false, errors };
  next.revision = model.revision + 1;
  return { ok: true, model: next };
}

function applyOne(m: ArchitectureModel, op: ModelOperation): string | undefined {
  switch (op.op) {
    case 'add_component': {
      if (!hasDefinition(op.component.type)) return `tipo desconocido ${op.component.type}`;
      if (m.components.some((c) => c.id === op.component.id)) return `ID duplicado ${op.component.id}`;
      m.components.push(clone(op.component));
      if (op.position) m.layout.positions[op.component.id] = { ...op.position };
      return;
    }
    case 'remove_component': {
      const idx = m.components.findIndex((c) => c.id === op.componentId);
      if (idx < 0) return `no existe ${op.componentId}`;
      m.components.splice(idx, 1);
      m.connections = m.connections.filter((c) => c.sourceId !== op.componentId && c.targetId !== op.componentId);
      for (const g of m.groups) g.memberIds = g.memberIds.filter((id) => id !== op.componentId);
      delete m.layout.positions[op.componentId];
      return;
    }
    case 'update_component': {
      const c = m.components.find((x) => x.id === op.componentId);
      if (!c) return `no existe ${op.componentId}`;
      if (op.patch.name !== undefined) c.name = op.patch.name;
      if (op.patch.props) c.props = { ...c.props, ...clone(op.patch.props) };
      return;
    }
    case 'move_component': {
      if (!m.components.some((c) => c.id === op.componentId)) return `no existe ${op.componentId}`;
      m.layout.positions[op.componentId] = { ...op.position };
      return;
    }
    case 'add_connection': {
      const k = op.connection;
      if (m.connections.some((c) => c.id === k.id)) return `ID duplicado ${k.id}`;
      const src = m.components.find((c) => c.id === k.sourceId);
      const dst = m.components.find((c) => c.id === k.targetId);
      if (!src || !dst) return 'origen o destino inexistente';
      if (src.id === dst.id) return 'una conexión no puede apuntar al mismo componente';
      if (!compatibleProtocols(src.type, dst.type).includes(k.protocol))
        return `${getDefinition(dst.type).label} no acepta ${k.protocol} desde ${getDefinition(src.type).label}`;
      m.connections.push(clone(k));
      return;
    }
    case 'remove_connection': {
      const before = m.connections.length;
      m.connections = m.connections.filter((c) => c.id !== op.connectionId);
      return before === m.connections.length ? `no existe ${op.connectionId}` : undefined;
    }
    case 'update_connection': {
      const k = m.connections.find((c) => c.id === op.connectionId);
      if (!k) return `no existe ${op.connectionId}`;
      const { props, ...rest } = op.patch;
      if (rest.protocol) {
        const src = m.components.find((c) => c.id === k.sourceId)!;
        const dst = m.components.find((c) => c.id === k.targetId)!;
        if (!compatibleProtocols(src.type, dst.type).includes(rest.protocol)) return `protocolo ${rest.protocol} incompatible`;
      }
      Object.assign(k, rest);
      if (props) k.props = { ...k.props, ...props };
      return;
    }
  }
}

let counter = 0;
/** Genera IDs legibles y únicos dentro del modelo (no criptográficos). */
export function nextId(model: ArchitectureModel, prefix: string): string {
  const taken = new Set([...model.components.map((c) => c.id), ...model.connections.map((c) => c.id), ...model.groups.map((g) => g.id)]);
  let n = taken.size + 1 + counter++;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
