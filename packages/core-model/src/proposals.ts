/**
 * Flujo de control de cambios (principios P5 y sección 10.5):
 *   propuesta (IA / motor de reglas) → validación → confirmación del usuario → actualización del modelo.
 * Una propuesta NUNCA se aplica si no fue aprobada explícitamente.
 */
import type { ChangeProposal, ModelOperation, ProposalSource } from './contracts';
import { applyOperations } from './operations';
import type { ApplyResult } from './operations';
import type { ArchitectureModel } from './types';

export function createProposal(
  model: ArchitectureModel,
  input: { id: string; source: ProposalSource; title: string; rationale: string; operations: ModelOperation[] }
): ChangeProposal {
  return { ...input, status: 'pending', baseRevision: model.revision };
}

/** Valida sin aplicar: devuelve el modelo resultante para previsualizar (dry-run). */
export function previewProposal(model: ArchitectureModel, proposal: ChangeProposal): ApplyResult {
  return applyOperations(model, proposal.operations);
}

export function decideProposal(proposal: ChangeProposal, decision: 'approved' | 'rejected' | 'postponed'): ChangeProposal {
  if (proposal.status === 'applied') throw new Error('La propuesta ya fue aplicada');
  return { ...proposal, status: decision };
}

export class ProposalNotApprovedError extends Error {
  constructor(id: string, status: string) {
    super(`La propuesta ${id} no puede aplicarse en estado "${status}": requiere aprobación explícita`);
  }
}

export function applyProposal(model: ArchitectureModel, proposal: ChangeProposal): ApplyResult & { proposal: ChangeProposal } {
  if (proposal.status !== 'approved') throw new ProposalNotApprovedError(proposal.id, proposal.status);
  if (proposal.baseRevision !== model.revision) {
    return { ok: false, errors: [`El modelo cambió (rev ${proposal.baseRevision} → ${model.revision}); regenere la propuesta`], proposal };
  }
  const r = applyOperations(model, proposal.operations);
  return r.ok ? { ...r, proposal: { ...proposal, status: 'applied' } } : { ...r, proposal };
}
