/**
 * Simulation Engine — API pública.
 *
 * `simulate(model, scenario)` es una función pura y determinista: mismas entradas semánticas →
 * mismos eventos, byte a byte. No depende de React, Three.js, WebGL ni del DOM.
 *
 * Modelo de ejecución: intérprete de árbol de llamadas con reloj lógico. Cada componente aporta
 * un comportamiento (behaviors/*) que emite eventos estructurados. Eventos de fondo (fallas
 * programadas, failover) se intercalan por marca de tiempo. Las solicitudes de un escenario se
 * procesan secuencialmente (supuesto documentado).
 */
import type { ArchitectureModel, RequestOutcome, Scenario, SimulationResult } from '@asa/core-model';
import { CONTRACT_VERSION, clone, datastoreProps } from '@asa/core-model';
import { runClientRequest } from './behaviors/client';
import type { SimRequest } from './behaviors/types';
import { isOk } from './behaviors/types';
import { canonicalJson, fnv1a } from './hash';
import { Run } from './run';
import type { Trace } from './run';

export const DISCLAIMER =
  'Simulación conceptual basada en reglas sobre el modelo. Latencias y tiempos son estimaciones; no es una medición de infraestructura real.';

/** ID estable: depende sólo de la semántica (componentes, conexiones, grupos, escenario), no de posiciones 3D ni metadatos. */
export function computeSimulationId(model: ArchitectureModel, scenario: Scenario): string {
  const semantic = { components: model.components, connections: model.connections, groups: model.groups, scenario };
  return `sim-${fnv1a(canonicalJson(semantic))}`;
}

export function simulate(model: ArchitectureModel, scenario: Scenario): SimulationResult {
  const simulationId = computeSimulationId(model, scenario);
  const run = new Run(model, scenario, simulationId);
  const sys = run.systemTrace;

  run.emit(sys, {
    type: 'SIMULATION_STARTED',
    status: 'info',
    data: { scenarioId: scenario.id, requestCount: scenario.requestCount, faults: scenario.faults.length, contractVersion: CONTRACT_VERSION },
    message: `Simulación "${scenario.name}" iniciada`,
    basic: scenario.description,
    advanced: `${scenario.requestCount} solicitud(es), ${scenario.faults.length} falla(s) inyectada(s). Ejecución determinista con reloj lógico.`
  });
  scheduleFaults(run, sys);

  const requests: RequestOutcome[] = [];
  for (let i = 0; i < Math.max(1, scenario.requestCount); i++) {
    run.clock = Math.max(run.clock, i * scenario.intervalMs);
    const trace: Trace = { traceId: `trace-${String(i + 1).padStart(2, '0')}` };
    const startedAt = run.clock;
    const req: SimRequest = {
      ...clone(scenario.request),
      host: '',
      headers: {
        'x-request-id': `${simulationId}-${i + 1}`,
        traceparent: `00-${fnv1a(simulationId + i).padEnd(32, '0')}-${fnv1a(String(i)).padEnd(16, '0')}-01`,
        'content-type': 'application/json'
      }
    };
    const { outcome, path } = runClientRequest(run, scenario.entryComponentId, req, trace);
    const ok = isOk(outcome);
    run.emit(trace, {
      type: 'REQUEST_COMPLETED',
      status: ok ? 'success' : 'error',
      sourceId: scenario.entryComponentId,
      data: { httpStatus: outcome.kind === 'response' ? outcome.status : undefined, outcome: outcome.kind },
      message: ok ? `Solicitud ${i + 1} completada con éxito` : `Solicitud ${i + 1} fallida`,
      basic: ok ? 'Todo funcionó.' : 'La solicitud no pudo completarse.',
      advanced: `Duración lógica total ${run.clock - startedAt} ms.`
    });
    const outcomeRecord: RequestOutcome = { traceId: trace.traceId, index: i, startedAt, finishedAt: run.clock, ok, path };
    if (outcome.kind === 'response') outcomeRecord.httpStatus = outcome.status;
    if (!ok) {
      outcomeRecord.error = outcome.kind === 'response' ? (outcome.error ?? `HTTP ${outcome.status}`) : outcome.reason;
      const failure = trace.rootFailure ?? (outcome.kind !== 'response' ? outcome.failure : outcome.failure);
      if (failure) outcomeRecord.failure = failure;
      if (trace.rootCauseEventId) outcomeRecord.rootCauseEventId = trace.rootCauseEventId;
    }
    requests.push(outcomeRecord);
  }
  run.flushAll();

  const okCount = requests.filter((r) => r.ok).length;
  const outcome = okCount === requests.length ? 'success' : okCount === 0 ? 'failure' : 'partial';
  run.emit(sys, {
    type: 'SIMULATION_COMPLETED',
    status: outcome === 'success' ? 'success' : outcome === 'partial' ? 'warning' : 'error',
    data: { ok: okCount, total: requests.length },
    message: `Simulación finalizada: ${okCount}/${requests.length} solicitudes exitosas`,
    basic: outcome === 'success' ? 'La arquitectura respondió como se esperaba.' : 'Hubo fallas: revise los eventos en rojo.',
    advanced: DISCLAIMER
  });

  const affected = new Set<string>();
  for (const e of run.events) if ((e.status === 'error' || e.status === 'warning') && e.sourceId && e.traceId !== sys.traceId) affected.add(e.sourceId);

  return {
    contractVersion: CONTRACT_VERSION,
    simulationId,
    scenarioId: scenario.id,
    modelRevision: model.revision,
    events: run.events,
    requests,
    outcome,
    affectedComponentIds: [...affected].sort(),
    provenance: { mode: 'simulation:rule-based', disclaimer: DISCLAIMER, assumptions: [...model.assumptions] }
  };
}

function scheduleFaults(run: Run, sys: Trace): void {
  for (const f of run.scenario.faults) {
    const at = f.kind === 'COMPONENT_DOWN' ? (f.fromT ?? 0) : 0;
    const target = 'componentId' in f ? f.componentId : f.connectionId;
    const label =
      f.kind === 'COMPONENT_DOWN'
        ? `${run.name(target)} cae`
        : f.kind === 'HTTP_ERROR'
          ? `${run.name(target)} responderá ${f.status}`
          : f.kind === 'POOL_EXHAUSTED'
            ? `Pool de conexiones de ${run.name(target)} agotado`
            : `+${f.extraMs} ms de latencia en ${target}`;
    run.schedule(at, () => {
      run.emit(sys, {
        type: 'FAULT_INJECTED',
        status: 'warning',
        ...(f.kind !== 'EXTRA_LATENCY' ? { sourceId: target } : { connectionId: target }),
        data: { fault: f },
        observable: false,
        message: `Falla inyectada: ${label}`,
        basic: 'El escenario introduce una falla controlada para estudiar la reacción del sistema.',
        advanced: 'Las fallas son condiciones de ejecución (no configuración): no modifican el modelo.'
      });
      if (f.kind === 'COMPONENT_DOWN' && run.behavior(target) === 'datastore') {
        const p = datastoreProps(run.comp(target));
        if (p.multiAz && p.failoverMs > 0) {
          run.emit(sys, {
            type: 'FAILOVER_STARTED',
            status: 'warning',
            sourceId: target,
            data: { estimatedMs: p.failoverMs },
            message: `${run.name(target)}: failover Multi-AZ iniciado (~${p.failoverMs} ms estimado)`,
            basic: 'La base de datos empieza a cambiar a su copia de respaldo.',
            advanced: 'Se promueve la standby y se actualiza el endpoint DNS de la instancia.'
          });
          run.schedule(at + p.failoverMs, () =>
            run.emit(sys, {
              type: 'FAILOVER_COMPLETED',
              status: 'success',
              sourceId: target,
              message: `${run.name(target)}: failover completado, standby promovida`,
              basic: 'La copia de respaldo ya atiende las consultas.',
              advanced: 'Las nuevas conexiones se dirigen a la nueva primaria.'
            })
          );
        }
      }
    });
  }
}
