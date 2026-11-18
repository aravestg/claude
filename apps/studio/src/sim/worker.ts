/// <reference lib="webworker" />
/**
 * El Simulation Engine se ejecuta aquí, fuera del hilo de render: sin DOM, sin WebGL, sin React.
 */
import { parseModel } from '@asa/core-model';
import { diagnose, simulate } from '@asa/simulation-engine';
import type { SimRequestMsg, SimResponseMsg } from './protocol';
import { WORKER_PROTOCOL } from './protocol';

self.onmessage = (e: MessageEvent<SimRequestMsg>) => {
  const msg = e.data;
  if (msg?.protocol !== WORKER_PROTOCOL) return;
  const started = performance.now();
  let res: SimResponseMsg;
  try {
    const parsed = parseModel(msg.model);
    if (!parsed.ok) throw new Error(`Modelo inválido: ${parsed.errors.slice(0, 3).join('; ')}`);
    const result = simulate(parsed.value, msg.scenario);
    res = { protocol: WORKER_PROTOCOL, id: msg.id, ok: true, result, recommendations: diagnose(parsed.value, result), elapsedMs: performance.now() - started };
  } catch (err) {
    res = { protocol: WORKER_PROTOCOL, id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
