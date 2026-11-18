/**
 * Derivación PURA del estado visual a partir de eventos pregrabados. No decide qué ocurre:
 * sólo traduce eventos (producidos por el Simulation Engine) a estados de presentación.
 * Testeable sin WebGL. Retroceder = recalcular hasta un cursor anterior.
 */
import type { EventStatus, SimulationEvent } from '@asa/core-model';

export type VisualStatus = 'idle' | 'active' | 'ok' | 'warning' | 'waiting' | 'error' | 'down';

export interface PacketState {
  eventId: string;
  connectionId: string;
  fromId: string;
  toId: string;
  progress: number;
  status: EventStatus;
  variant: 'dns' | 'syn' | 'request' | 'response' | 'query' | 'rst' | 'error';
  label: string;
  /** Texto del mensaje en vuelo, tomado de los datos del evento (no inventado). */
  caption: string;
}

export interface SceneState {
  components: Record<string, { status: VisualStatus; badge?: string }>;
  connections: Record<string, { status: VisualStatus; traversed: boolean }>;
  packet?: PacketState;
  focusId?: string;
  currentEventId?: string;
  traceId?: string;
}

/** Peso de visualización de cada evento (unidades de reproducción). */
export function displayWeight(e: SimulationEvent): number {
  if (e.kind === 'transfer') return 1;
  if (e.status === 'error') return 0.9;
  if (e.type === 'CONNECTION_TIMEOUT' || e.type === 'RETRY_STARTED') return 0.9;
  return 0.45;
}

const statusMap: Record<EventStatus, VisualStatus> = { info: 'active', active: 'active', success: 'ok', warning: 'warning', error: 'error' };

function variantOf(e: SimulationEvent): PacketState['variant'] {
  switch (e.type) {
    case 'DNS_RESOLUTION_STARTED':
    case 'DNS_RESOLVED':
      return e.status === 'error' ? 'error' : 'dns';
    case 'CONNECTION_ATTEMPTED':
      return 'syn';
    case 'CONNECTION_REFUSED':
      return 'rst';
    case 'DATABASE_QUERY_STARTED':
    case 'DATABASE_QUERY_COMPLETED':
      return 'query';
    case 'RESPONSE_SENT':
      return e.status === 'error' ? 'error' : 'response';
    case 'ERROR_RETURNED':
      return 'error';
    default:
      return 'request';
  }
}

/** Texto corto del mensaje transportado, derivado de `event.data`. */
export function captionFor(e: SimulationEvent): string {
  const d = e.data;
  switch (e.type) {
    case 'DNS_RESOLUTION_STARTED':
      return `DNS ${String(d['query'] ?? '?')}`;
    case 'DNS_RESOLVED':
      return d['rcode'] ? `DNS ${String(d['rcode'])}` : `DNS → ${String(d['resolvedTo'] ?? '')}`;
    case 'CONNECTION_ATTEMPTED':
      return `SYN :${String(d.port ?? '')}`;
    case 'CONNECTION_REFUSED':
      return 'RST ✕';
    case 'DATABASE_QUERY_STARTED':
      return d['statement'] ? `SQL ${String(d['statement']).split(' ').slice(0, 2).join(' ')}…` : `${String(d['operation'] ?? 'query')}`;
    case 'DATABASE_QUERY_COMPLETED':
      return d['queryMs'] !== undefined ? `resultado · ${String(d['queryMs'])} ms` : 'resultado';
    case 'RESPONSE_SENT':
    case 'ERROR_RETURNED':
      return d.httpStatus !== undefined ? `HTTP ${String(d.httpStatus)}` : 'respuesta';
    case 'REQUEST_SENT':
      return `${String(d.method ?? '')} ${String(d.path ?? '')}`.trim() || 'solicitud';
    default:
      return e.type;
  }
}

function badgeFor(e: SimulationEvent): string | undefined {
  switch (e.type) {
    case 'ACCESS_DENIED':
      return '⛔ Denegado';
    case 'PACKET_DROPPED':
      return '⛔ Descartado';
    case 'CONNECTION_TIMEOUT':
      return '⏱ Timeout';
    case 'RETRY_STARTED':
      return `↻ Reintento ${e.data.attempt ? Number(e.data.attempt) - 1 : ''}`.trim();
    case 'CIRCUIT_BREAKER_OPENED':
    case 'CIRCUIT_BREAKER_REJECTED':
      return '⚡ CB abierto';
    case 'CIRCUIT_BREAKER_CLOSED':
      return '✔ CB cerrado';
    case 'HEALTH_CHECK_FAILED':
      return '♥ Health check';
    case 'AUTHENTICATION_FAILED':
      return '🔒 401';
    case 'SERVICE_UNAVAILABLE':
      return '✖ No disponible';
    case 'FAILOVER_STARTED':
      return '⇄ Failover';
    case 'POOL_EXHAUSTED':
      return '▣ Pool agotado';
    case 'ERROR_RETURNED':
      return e.data.httpStatus ? `✖ ${String(e.data.httpStatus)}` : '✖ Error';
    default:
      return undefined;
  }
}

/**
 * Estado de la escena tras aplicar los eventos [0, cursor) completos y el evento `cursor`
 * con avance `progress` ∈ [0,1].
 */
export function deriveSceneState(events: readonly SimulationEvent[], cursor: number, progress = 1): SceneState {
  const state: SceneState = { components: {}, connections: {} };
  if (!events.length || cursor < 0) return state;
  const last = Math.min(cursor, events.length - 1);
  const down = new Set<string>();

  for (let i = 0; i <= last; i++) {
    const e = events[i]!;
    const partial = i === last && progress < 1;

    if (e.type === 'REQUEST_STARTED') {
      // nueva traza: se limpian estados transitorios, se conservan componentes caídos
      for (const id of Object.keys(state.components)) if (!down.has(id)) delete state.components[id];
      state.connections = {};
      state.traceId = e.traceId;
    }
    if (e.type === 'FAULT_INJECTED' && e.sourceId && (e.data['fault'] as { kind?: string } | undefined)?.kind === 'COMPONENT_DOWN') {
      down.add(e.sourceId);
      state.components[e.sourceId] = { status: 'down', badge: '⬇ Caído' };
      continue;
    }
    if (e.type === 'FAILOVER_COMPLETED' && e.sourceId) {
      down.delete(e.sourceId);
      state.components[e.sourceId] = { status: 'ok', badge: '⇄ Standby activa' };
      continue;
    }

    if (e.kind === 'transfer' && e.connectionId && e.sourceId && e.targetId) {
      const vs = statusMap[e.status];
      state.connections[e.connectionId] = { status: vs, traversed: true };
      // el origen de una transferencia completada queda OK, salvo que ya muestre un error (se conserva su insignia)
      if (!down.has(e.sourceId) && !partial && state.components[e.sourceId]?.status !== 'error') state.components[e.sourceId] = { status: 'ok' };
      if (partial) {
        state.packet = {
          eventId: e.id,
          connectionId: e.connectionId,
          fromId: e.sourceId,
          toId: e.targetId,
          progress,
          status: e.status,
          variant: variantOf(e),
          label: String(e.data.protocol ?? '') + (e.data.port ? `:${String(e.data.port)}` : ''),
          caption: captionFor(e)
        };
      } else if (!down.has(e.targetId)) {
        state.components[e.targetId] = { status: vs === 'error' ? 'error' : 'active' };
      }
    } else if (e.sourceId) {
      let vs = statusMap[e.status];
      if (e.type === 'CONNECTION_TIMEOUT' && partial) vs = 'waiting';
      if (e.type === 'RETRY_STARTED') vs = 'waiting';
      const badge = badgeFor(e);
      if (down.has(e.sourceId) && e.status !== 'error') continue;
      state.components[e.sourceId] = badge ? { status: down.has(e.sourceId) ? 'down' : vs, badge } : { status: down.has(e.sourceId) ? 'down' : vs };
    }
    if (i === last) {
      state.currentEventId = e.id;
      state.focusId = e.kind === 'transfer' && !partial ? e.targetId : (e.sourceId ?? e.targetId);
      if (e.kind === 'transfer' && partial) state.focusId = e.targetId;
    }
  }
  return state;
}

/** Reloj de reproducción: convierte (cursor, progress) avanzando `units` unidades. */
export function advancePlayhead(
  events: readonly SimulationEvent[],
  cursor: number,
  progress: number,
  units: number
): { cursor: number; progress: number; finished: boolean } {
  let c = Math.max(0, cursor);
  let p = progress;
  let remaining = units;
  while (remaining > 0 && c < events.length) {
    const w = displayWeight(events[c]!);
    const left = (1 - p) * w;
    if (remaining < left) {
      p += remaining / w;
      remaining = 0;
    } else {
      remaining -= left;
      if (c === events.length - 1) return { cursor: c, progress: 1, finished: true };
      c += 1;
      p = 0;
    }
  }
  return { cursor: c, progress: p, finished: c >= events.length - 1 && p >= 1 };
}
