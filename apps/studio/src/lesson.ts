/**
 * Estructura de "lección" derivada EXCLUSIVAMENTE de los eventos de simulación:
 * capítulos del stepper, hitos del recorrido y etiquetas de narración. Lógica pura y testeable.
 */
import type { EventType, SimulationEvent } from '@asa/core-model';

const CHAPTER_OF: Partial<Record<EventType, string>> = {
  DNS_RESOLUTION_STARTED: 'DNS',
  CONNECTION_ATTEMPTED: 'Conexión',
  RULE_EVALUATED: 'Firewall',
  ACCESS_DENIED: 'Bloqueo',
  AUTHENTICATION_STARTED: 'Autenticación',
  HEALTH_CHECK_FAILED: 'Health check',
  BACKEND_SELECTED: 'Balanceo',
  PROCESSING_STARTED: 'Backend',
  DATABASE_QUERY_STARTED: 'Datos',
  PACKET_DROPPED: 'Descarte',
  RETRY_STARTED: 'Reintento',
  ASYNC_DISPATCHED: 'Asíncrono',
  ASYNC_DELIVERY_FAILED: 'Mensaje perdido',
  CIRCUIT_BREAKER_OPENED: 'Breaker',
  CIRCUIT_BREAKER_REJECTED: 'Fail-fast',
  FAILOVER_COMPLETED: 'Failover',
  RESPONSE_RECEIVED: 'Respuesta',
  SIMULATION_COMPLETED: 'Resumen'
};

export interface Chapter {
  label: string;
  startSeq: number;
  status: SimulationEvent['status'];
}

export function chaptersOf(events: readonly SimulationEvent[], max = 12): Chapter[] {
  const multi = events.filter((e) => e.type === 'REQUEST_STARTED').length > 1;
  const raw: Chapter[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    let label = CHAPTER_OF[e.type];
    if (e.type === 'REQUEST_STARTED') label = multi ? `Solicitud ${Number(e.traceId.replace(/\D/g, '')) || 1}` : 'Inicio';
    if (!label) continue;
    const key = `${e.traceId}:${label}`;
    if (seen.has(key) && e.type !== 'REQUEST_STARTED') {
      const same = [...raw].reverse().find((c) => c.label === label);
      if (same && e.status === 'error') same.status = 'error';
      continue;
    }
    seen.add(key);
    const prev = raw[raw.length - 1];
    if (prev && prev.label === label) {
      if (e.status === 'error') prev.status = 'error';
      continue;
    }
    raw.push({ label, startSeq: e.seq, status: e.type === 'RESPONSE_RECEIVED' || e.type === 'SIMULATION_COMPLETED' ? e.status : e.status === 'error' ? 'error' : 'info' });
  }
  if (raw.length <= max) return raw;
  // demasiados capítulos: se conservan inicios de solicitud, problemas y el resumen
  const keep = raw.filter((c, i) => i === 0 || c.label.startsWith('Solicitud') || c.status === 'error' || c.label === 'Failover' || c.label === 'Resumen');
  const out: Chapter[] = [];
  for (const c of keep) if (out[out.length - 1]?.label !== c.label) out.push(c);
  return out.slice(0, max - 1).concat(out.length > max ? [out[out.length - 1]!] : []);
}

export function currentChapter(chapters: readonly Chapter[], cursor: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i]!.startSeq <= cursor) idx = i;
  return idx;
}

interface MilestoneDef {
  label: string;
  reached: EventType[];
  failed: EventType[];
}
const MILESTONES: MilestoneDef[] = [
  { label: 'Resolver el nombre por DNS', reached: ['DNS_RESOLVED'], failed: ['DNS_RESOLUTION_FAILED'] },
  { label: 'Abrir la conexión TCP + TLS', reached: ['CONNECTION_ESTABLISHED'], failed: ['CONNECTION_REFUSED'] },
  { label: 'Pasar las reglas del firewall', reached: ['RULE_EVALUATED'], failed: [] },
  { label: 'Autenticar en el gateway', reached: ['AUTHENTICATION_SUCCEEDED'], failed: ['AUTHENTICATION_FAILED'] },
  { label: 'Balancear hacia un destino sano', reached: ['BACKEND_SELECTED'], failed: [] },
  { label: 'Procesar en el backend', reached: ['PROCESSING_STARTED'], failed: [] },
  { label: 'Consultar la base de datos', reached: ['DATABASE_QUERY_COMPLETED'], failed: ['PACKET_DROPPED'] },
  { label: 'Recuperarse con failover', reached: ['FAILOVER_COMPLETED'], failed: [] },
  { label: 'Entregar la respuesta al usuario', reached: ['RESPONSE_RECEIVED'], failed: [] }
];

export interface Milestone {
  label: string;
  state: 'pending' | 'done' | 'failed';
}

/** Hitos relevantes para ESTA simulación (sólo los que aparecen en sus eventos), con su estado al cursor. */
export function milestonesOf(events: readonly SimulationEvent[], cursor: number): Milestone[] {
  const present = new Set(events.map((e) => e.type));
  const played = events.slice(0, Math.max(0, cursor + 1));
  return MILESTONES.filter((m) => [...m.reached, ...m.failed].some((t) => present.has(t)) || (m.label.startsWith('Entregar') && events.length > 0)).map((m) => {
    const hit = played.filter((e) => m.reached.includes(e.type) || m.failed.includes(e.type));
    const last = hit[hit.length - 1];
    let state: Milestone['state'] = 'pending';
    if (last) state = m.failed.includes(last.type) || last.status === 'error' ? 'failed' : 'done';
    return { label: m.label, state };
  });
}

export type NarrationTag = { label: string; tone: 'problem' | 'success' | 'wait' | 'comm' | 'state' };

export function tagOf(e: SimulationEvent): NarrationTag {
  if (e.status === 'error') return { label: 'Problema', tone: 'problem' };
  if (e.status === 'warning') return { label: 'Resiliencia', tone: 'wait' };
  if (e.status === 'success') return { label: 'Éxito', tone: 'success' };
  if (e.kind === 'transfer') return { label: 'Comunicación', tone: 'comm' };
  return { label: 'Estado', tone: 'state' };
}

/** "Qué cambió": hechos concretos tomados de event.data. */
export function changesOf(e: SimulationEvent, name: (id?: string) => string): { mark: '+' | '~' | '✕'; text: string }[] {
  const d = e.data;
  const out: { mark: '+' | '~' | '✕'; text: string }[] = [];
  if (e.sourceId) out.push({ mark: '~', text: e.targetId ? `${name(e.sourceId)} → ${name(e.targetId)}` : name(e.sourceId) });
  if (d.protocol) out.push({ mark: '+', text: `Protocolo / puerto: ${d.protocol}${d.port ? `:${d.port}` : ''}` });
  if (d.method && d.path) out.push({ mark: '+', text: `${d.method} ${d.path}` });
  if (d['async']) out.push({ mark: '~', text: 'Asíncrono: el emisor no espera respuesta' });
  if (d.httpStatus !== undefined) out.push({ mark: Number(d.httpStatus) >= 400 ? '✕' : '+', text: `HTTP ${String(d.httpStatus)}` });
  if (d.ruleId) out.push({ mark: d['action'] === 'deny' ? '✕' : '+', text: `Regla: ${d.ruleId} (${String(d['action'] ?? '')})` });
  if (d['timeoutMs'] !== undefined) out.push({ mark: '✕', text: `Timeout: ${String(d['timeoutMs'])} ms` });
  if (d['backoffMs'] !== undefined) out.push({ mark: '~', text: `Backoff: ${String(d['backoffMs'])} ms (intento ${String(d.attempt)})` });
  if (d['queryMs'] !== undefined) out.push({ mark: '+', text: `Consulta: ${String(d['queryMs'])} ms` });
  if (d['rttMs'] !== undefined) out.push({ mark: '+', text: `RTT: ${String(d['rttMs'])} ms` });
  if (e.duration) out.push({ mark: '~', text: `Duración lógica: +${e.duration} ms` });
  if (e.failure) out.push({ mark: '✕', text: `Falla de tipo: ${e.failure}` });
  return out;
}

/** Nombre corto en español de cada tipo de evento (para "Siguiente: …"). */
export const EVENT_LABEL: Record<EventType, string> = {
  SIMULATION_STARTED: 'Inicio',
  FAULT_INJECTED: 'Falla inyectada',
  REQUEST_STARTED: 'Nueva solicitud',
  DNS_RESOLUTION_STARTED: 'Consulta DNS',
  DNS_RESOLVED: 'Respuesta DNS',
  DNS_RESOLUTION_FAILED: 'DNS falla',
  CONNECTION_ATTEMPTED: 'Abrir conexión',
  RULE_EVALUATED: 'Regla de firewall',
  ACCESS_DENIED: 'Acceso denegado',
  PACKET_DROPPED: 'Paquete descartado',
  CONNECTION_REFUSED: 'Conexión rechazada',
  CONNECTION_ESTABLISHED: 'Conexión abierta',
  TLS_HANDSHAKE_COMPLETED: 'TLS negociado',
  CONNECTION_TIMEOUT: 'Timeout',
  REQUEST_SENT: 'Enviar solicitud',
  REQUEST_RECEIVED: 'Solicitud recibida',
  AUTHENTICATION_STARTED: 'Validar token',
  AUTHENTICATION_SUCCEEDED: 'Token válido',
  AUTHENTICATION_FAILED: 'Token inválido',
  HEALTH_CHECK_FAILED: 'Health check',
  BACKEND_SELECTED: 'Elegir destino',
  PROCESSING_STARTED: 'Procesar',
  POOL_CONNECTION_ACQUIRED: 'Tomar conexión',
  POOL_EXHAUSTED: 'Pool agotado',
  DATABASE_QUERY_STARTED: 'Consultar datos',
  DATABASE_QUERY_COMPLETED: 'Resultado',
  FAILOVER_STARTED: 'Iniciar failover',
  FAILOVER_COMPLETED: 'Failover listo',
  SERVICE_UNAVAILABLE: 'No disponible',
  RETRY_STARTED: 'Reintentar',
  CIRCUIT_BREAKER_OPENED: 'Abrir breaker',
  CIRCUIT_BREAKER_REJECTED: 'Fallar rápido',
  CIRCUIT_BREAKER_CLOSED: 'Cerrar breaker',
  ERROR_RETURNED: 'Devolver error',
  ASYNC_DISPATCHED: 'Mensaje asíncrono',
  ASYNC_DELIVERED: 'Entrega asíncrona',
  ASYNC_DELIVERY_FAILED: 'Entrega fallida',
  RESPONSE_SENT: 'Responder',
  RESPONSE_RECEIVED: 'Respuesta recibida',
  REQUEST_COMPLETED: 'Fin de solicitud',
  SIMULATION_COMPLETED: 'Resumen'
};

export const KIND_LABEL: Record<string, { label: string; tone: string }> = {
  success: { label: 'Éxito', tone: 'green' },
  block: { label: 'Bloqueo', tone: 'rose' },
  failure: { label: 'Falla', tone: 'orange' },
  resilience: { label: 'Resiliencia', tone: 'violet' },
  custom: { label: 'Personalizado', tone: 'violet' }
};
