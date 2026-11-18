import type { ArchitectureModel, ChangeProposal } from '@asa/core-model';

/**
 * Rebase seguro: una propuesta construida sobre una revisión anterior sólo se re-basa si
 * ninguno de los elementos que modifica cambió desde esa revisión. Si no, se rechaza por obsoleta.
 */
export function rebaseIfSafe(p: ChangeProposal, current: ArchitectureModel, history: ArchitectureModel[]): ChangeProposal {
  if (p.baseRevision === current.revision) return p;
  const base = [...history].reverse().find((m) => m.revision === p.baseRevision);
  if (!base) return p;
  const touched = new Set(
    p.operations.map((op) => ('componentId' in op ? op.componentId : 'connectionId' in op ? op.connectionId : 'component' in op ? op.component.id : op.connection.id))
  );
  const snap = (m: ArchitectureModel) =>
    JSON.stringify([...touched].map((id) => [m.components.find((c) => c.id === id) ?? null, m.connections.find((k) => k.id === id) ?? null]));
  return snap(base) === snap(current) ? { ...p, baseRevision: current.revision } : p;
}

