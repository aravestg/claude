import type { ArchitectureModel, Recommendation, Scenario, SimulationResult } from '@asa/core-model';
import { diagnose, simulate } from '@asa/simulation-engine';
import type { SimResponseMsg } from './protocol';
import { WORKER_PROTOCOL } from './protocol';

export interface SimOutput {
  result: SimulationResult;
  recommendations: Recommendation[];
  elapsedMs: number;
  runtime: 'worker' | 'main-thread';
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: SimResponseMsg) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SimResponseMsg>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export async function runSimulation(model: ArchitectureModel, scenario: Scenario): Promise<SimOutput> {
  const w = getWorker();
  if (w) {
    const id = ++seq;
    const res = await new Promise<SimResponseMsg>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('El worker de simulación no respondió'));
      }, 10000);
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      w.postMessage({ protocol: WORKER_PROTOCOL, id, model, scenario });
    }).catch(() => null);
    if (res?.ok) return { result: res.result, recommendations: res.recommendations, elapsedMs: res.elapsedMs, runtime: 'worker' };
    if (res && !res.ok) throw new Error(res.error);
  }
  // Respaldo: el motor es puro y también corre en el hilo principal.
  const t0 = performance.now();
  const result = simulate(model, scenario);
  return { result, recommendations: diagnose(model, result), elapsedMs: performance.now() - t0, runtime: 'main-thread' };
}
