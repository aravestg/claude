/** Contrato de mensajes UI ↔ Worker de simulación (versionado). */
import type { ArchitectureModel, Recommendation, Scenario, SimulationResult } from '@asa/core-model';

export const WORKER_PROTOCOL = 'asa-sim/1';

export interface SimRequestMsg {
  protocol: typeof WORKER_PROTOCOL;
  id: number;
  model: ArchitectureModel;
  scenario: Scenario;
}
export type SimResponseMsg =
  | { protocol: typeof WORKER_PROTOCOL; id: number; ok: true; result: SimulationResult; recommendations: Recommendation[]; elapsedMs: number }
  | { protocol: typeof WORKER_PROTOCOL; id: number; ok: false; error: string };
