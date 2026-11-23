/**
 * Estado de una ejecución: reloj lógico, registro de eventos, fallas activas y estado de
 * mecanismos de resiliencia (circuit breakers, round-robin). Determinista: sin reloj de pared ni aleatoriedad.
 */
import type {
  ArchitectureModel,
  BehaviorKind,
  ComponentInstance,
  Connection,
  EventKind,
  EventStatus,
  EventType,
  FailureCategory,
  Fault,
  Scenario,
  SimulationEvent,
  EventData
} from '@asa/core-model';
import { datastoreProps, getDefinition } from '@asa/core-model';

export interface Trace {
  traceId: string;
  lastEventId?: string;
  rootCauseEventId?: string;
  rootFailure?: FailureCategory;
}

export interface EmitInput {
  type: EventType;
  kind?: EventKind;
  status: EventStatus;
  sourceId?: string;
  targetId?: string;
  connectionId?: string;
  duration?: number;
  failure?: FailureCategory;
  data?: EventData;
  message: string;
  basic: string;
  advanced: string;
  observable?: boolean;
  /** Si es false, el reloj no avanza con la duración (la espera se modela aparte). */
  advance?: boolean;
}

interface Background {
  t: number;
  fire: () => void;
}

export interface BreakerState {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  openedAt: number;
}

export const SYSTEM_TRACE = 'trace-system';

export class Run {
  clock = 0;
  readonly events: SimulationEvent[] = [];
  readonly breakers = new Map<string, BreakerState>();
  readonly roundRobin = new Map<string, number>();
  private readonly background: Background[] = [];
  private flushing = false;
  private readonly byId: Map<string, ComponentInstance>;
  readonly systemTrace: Trace = { traceId: SYSTEM_TRACE };

  constructor(
    readonly model: ArchitectureModel,
    readonly scenario: Scenario,
    readonly simulationId: string
  ) {
    this.byId = new Map(model.components.map((c) => [c.id, c]));
  }

  // ---------- consultas al modelo ----------
  comp(id: string): ComponentInstance {
    const c = this.byId.get(id);
    if (!c) throw new Error(`Componente inexistente: ${id}`);
    return c;
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  behavior(id: string): BehaviorKind {
    return getDefinition(this.comp(id).type).behavior;
  }
  name(id: string): string {
    return this.byId.get(id)?.name ?? id;
  }
  outgoing(id: string): Connection[] {
    return this.model.connections.filter((k) => k.sourceId === id).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }
  latency(k: Connection): number {
    const extra = this.scenario.faults
      .filter((f): f is Extract<Fault, { kind: 'EXTRA_LATENCY' }> => f.kind === 'EXTRA_LATENCY' && f.connectionId === k.id)
      .reduce((s, f) => s + f.extraMs, 0);
    return k.props.latencyMs + extra;
  }

  // ---------- fallas ----------
  downFault(id: string): Extract<Fault, { kind: 'COMPONENT_DOWN' }> | undefined {
    return this.scenario.faults.find(
      (f): f is Extract<Fault, { kind: 'COMPONENT_DOWN' }> =>
        f.kind === 'COMPONENT_DOWN' && f.componentId === id && this.clock >= (f.fromT ?? 0) && (f.untilT === undefined || this.clock < f.untilT)
    );
  }
  /** Disponible = no caído, o (datastore Multi-AZ y failover ya completado). */
  isAvailable(id: string): boolean {
    const f = this.downFault(id);
    if (!f) return true;
    if (this.behavior(id) === 'datastore') {
      const p = datastoreProps(this.comp(id));
      // sólo hay failover si existe una standby con tiempo de conmutación definido
      if (p.multiAz && p.failoverMs > 0 && this.clock >= (f.fromT ?? 0) + p.failoverMs) return true;
    }
    return false;
  }
  failoverInProgress(id: string): boolean {
    const f = this.downFault(id);
    return !!f && this.behavior(id) === 'datastore' && datastoreProps(this.comp(id)).multiAz && datastoreProps(this.comp(id)).failoverMs > 0 && !this.isAvailable(id);
  }
  httpErrorFault(id: string): Extract<Fault, { kind: 'HTTP_ERROR' }> | undefined {
    return this.scenario.faults.find((f): f is Extract<Fault, { kind: 'HTTP_ERROR' }> => f.kind === 'HTTP_ERROR' && f.componentId === id);
  }
  poolExhausted(id: string): boolean {
    return this.scenario.faults.some((f) => f.kind === 'POOL_EXHAUSTED' && f.componentId === id);
  }

  // ---------- eventos ----------
  schedule(t: number, fire: () => void): void {
    this.background.push({ t, fire });
    this.background.sort((a, b) => a.t - b.t);
  }

  /** Emite eventos de fondo cuyo tiempo ya llegó, preservando el orden temporal. */
  flush(upTo: number): void {
    if (this.flushing) return;
    this.flushing = true;
    while (this.background.length && this.background[0]!.t <= upTo) {
      const b = this.background.shift()!;
      const saved = this.clock;
      this.clock = Math.max(b.t, this.lastT());
      b.fire();
      this.clock = Math.max(saved, this.clock);
    }
    this.flushing = false;
  }
  flushAll(): void {
    if (this.background.length) this.flush(Number.POSITIVE_INFINITY);
  }
  private lastT(): number {
    const e = this.events[this.events.length - 1];
    return e ? e.t : 0;
  }

  emit(trace: Trace, input: EmitInput): SimulationEvent {
    this.flush(this.clock);
    const seq = this.events.length;
    const duration = Math.max(0, input.duration ?? 0);
    const ev: SimulationEvent = {
      id: `${this.simulationId}:${String(seq).padStart(4, '0')}`,
      simulationId: this.simulationId,
      seq,
      t: this.clock,
      duration,
      type: input.type,
      kind: input.kind ?? (input.targetId && input.connectionId ? 'transfer' : 'state'),
      status: input.status,
      traceId: trace.traceId,
      data: input.data ?? {},
      message: input.message,
      explanation: { basic: input.basic, advanced: input.advanced },
      observableInRealSystem: input.observable ?? true,
      provenance: 'simulation:rule-based'
    };
    if (input.sourceId) ev.sourceId = input.sourceId;
    if (input.targetId) ev.targetId = input.targetId;
    if (input.connectionId) ev.connectionId = input.connectionId;
    if (input.failure) ev.failure = input.failure;
    if (trace.lastEventId) ev.causedBy = trace.lastEventId;
    this.events.push(ev);
    trace.lastEventId = ev.id;
    if (input.status === 'error' && !trace.rootCauseEventId) {
      trace.rootCauseEventId = ev.id;
      if (input.failure) trace.rootFailure = input.failure;
    }
    if (input.advance !== false) this.clock += duration;
    return ev;
  }

  breaker(key: string): BreakerState {
    let b = this.breakers.get(key);
    if (!b) {
      b = { state: 'closed', failures: 0, openedAt: 0 };
      this.breakers.set(key, b);
    }
    return b;
  }
}
