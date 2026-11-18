import type { FailureCategory, ScenarioRequest } from '@asa/core-model';

export interface SimRequest extends ScenarioRequest {
  host: string;
  headers: Record<string, string>;
}

export type Outcome =
  | { kind: 'response'; status: number; body?: Record<string, unknown>; error?: string; failure?: FailureCategory }
  /** El destino no respondió (caído o paquetes descartados): el llamador espera su timeout. */
  | { kind: 'no_response'; failure: FailureCategory; reason: string }
  /** El destino o un intermediario rechazó activamente (RST). */
  | { kind: 'refused'; failure: FailureCategory; reason: string };

export const isOk = (o: Outcome) => o.kind === 'response' && o.status < 400;
