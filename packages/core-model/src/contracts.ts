/**
 * Contratos versionados entre motores (sección 10.5).
 *
 *   Editor/IA ──ModelOperation──▶ Model Engine ──ArchitectureModel + Scenario──▶ Simulation Engine
 *   Simulation Engine ──SimulationEvent[]──▶ 3D Visualization Engine / consola / CLI / reportes
 *
 * Estos tipos no dependen de React, Three.js ni del DOM.
 */
import type { ComponentInstance, Connection, Protocol, Vec3 } from './types';

export const CONTRACT_VERSION = '1.0.0' as const;

// ---------------- Escenarios ----------------

export type Fault =
  | { kind: 'COMPONENT_DOWN'; componentId: string; fromT?: number; untilT?: number }
  | { kind: 'HTTP_ERROR'; componentId: string; status: 401 | 403 | 404 | 429 | 500 | 503 }
  | { kind: 'POOL_EXHAUSTED'; componentId: string }
  | { kind: 'EXTRA_LATENCY'; connectionId: string; extraMs: number };

export interface ScenarioRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  /** Payload SINTÉTICO. Nunca datos reales. */
  payload: Record<string, unknown>;
  auth: 'valid' | 'missing' | 'invalid';
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  kind: 'success' | 'block' | 'failure' | 'resilience' | 'custom';
  entryComponentId: string;
  request: ScenarioRequest;
  requestCount: number;
  intervalMs: number;
  faults: Fault[];
  /** Operaciones de configuración que el escenario propone aplicar al modelo (p.ej. activar una regla). */
  setup?: ModelOperation[];
  /** Resultado esperado (para pruebas y para la UI). */
  expectation?: { outcome: 'success' | 'failure' | 'partial' };
}

// ---------------- Eventos ----------------

export const EVENT_TYPES = [
  'SIMULATION_STARTED',
  'FAULT_INJECTED',
  'REQUEST_STARTED',
  'DNS_RESOLUTION_STARTED',
  'DNS_RESOLVED',
  'DNS_RESOLUTION_FAILED',
  'CONNECTION_ATTEMPTED',
  'RULE_EVALUATED',
  'ACCESS_DENIED',
  'PACKET_DROPPED',
  'CONNECTION_REFUSED',
  'CONNECTION_ESTABLISHED',
  'TLS_HANDSHAKE_COMPLETED',
  'CONNECTION_TIMEOUT',
  'REQUEST_SENT',
  'REQUEST_RECEIVED',
  'AUTHENTICATION_STARTED',
  'AUTHENTICATION_SUCCEEDED',
  'AUTHENTICATION_FAILED',
  'HEALTH_CHECK_FAILED',
  'BACKEND_SELECTED',
  'PROCESSING_STARTED',
  'POOL_CONNECTION_ACQUIRED',
  'POOL_EXHAUSTED',
  'DATABASE_QUERY_STARTED',
  'DATABASE_QUERY_COMPLETED',
  'FAILOVER_STARTED',
  'FAILOVER_COMPLETED',
  'SERVICE_UNAVAILABLE',
  'RETRY_STARTED',
  'CIRCUIT_BREAKER_OPENED',
  'CIRCUIT_BREAKER_REJECTED',
  'CIRCUIT_BREAKER_CLOSED',
  'ERROR_RETURNED',
  'RESPONSE_SENT',
  'RESPONSE_RECEIVED',
  'REQUEST_COMPLETED',
  'SIMULATION_COMPLETED'
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** transfer: algo viaja por una conexión (anima partícula). state: cambio de estado en un componente. */
export type EventKind = 'transfer' | 'state';
export type EventStatus = 'info' | 'active' | 'success' | 'warning' | 'error';

/**
 * Categoría de falla. Los bloqueos de red, autorización, disponibilidad y aplicación
 * se modelan de forma diferenciada (sección 8).
 */
export type FailureCategory = 'network' | 'authorization' | 'authentication' | 'availability' | 'application' | 'capacity' | 'dns';

export interface SimulationEvent {
  id: string;
  simulationId: string;
  /** Orden total del evento dentro de la simulación. */
  seq: number;
  /** Marca de tiempo LÓGICA en ms (no reloj real). */
  t: number;
  /** Duración lógica (ms). >0 en transferencias y esperas. */
  duration: number;
  type: EventType;
  kind: EventKind;
  status: EventStatus;
  /** Componente donde ocurre (state) o desde donde sale (transfer). */
  sourceId?: string;
  /** Componente destino (transfer). */
  targetId?: string;
  connectionId?: string;
  /** Traza = una solicitud de extremo a extremo. */
  traceId: string;
  /** Evento que lo causó (relación con eventos anteriores). */
  causedBy?: string;
  failure?: FailureCategory;
  data: EventData;
  message: string;
  explanation: { basic: string; advanced: string };
  /** ¿Es observable en un sistema real (logs/métricas) o solo dentro de la simulación? */
  observableInRealSystem: boolean;
  provenance: 'simulation:rule-based';
}

export interface EventData {
  protocol?: Protocol;
  port?: number;
  httpStatus?: number;
  method?: string;
  path?: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  ruleId?: string;
  attempt?: number;
  [k: string]: unknown;
}

// ---------------- Resultado ----------------

export interface RequestOutcome {
  traceId: string;
  index: number;
  startedAt: number;
  finishedAt: number;
  ok: boolean;
  httpStatus?: number;
  error?: string;
  failure?: FailureCategory;
  /** Primer evento de error de la traza (punto de bloqueo o causa raíz). */
  rootCauseEventId?: string;
  path: string[];
}

export interface SimulationResult {
  contractVersion: typeof CONTRACT_VERSION;
  simulationId: string;
  scenarioId: string;
  modelRevision: number;
  events: SimulationEvent[];
  requests: RequestOutcome[];
  outcome: 'success' | 'failure' | 'partial';
  /** Componentes involucrados en fallas. */
  affectedComponentIds: string[];
  provenance: {
    mode: 'simulation:rule-based';
    disclaimer: string;
    assumptions: string[];
  };
}

// ---------------- Operaciones sobre el modelo ----------------

export type ModelOperation =
  | { op: 'add_component'; component: ComponentInstance; position?: Vec3 }
  | { op: 'remove_component'; componentId: string }
  | { op: 'update_component'; componentId: string; patch: { name?: string; props?: Record<string, unknown> } }
  | { op: 'move_component'; componentId: string; position: Vec3 }
  | { op: 'add_connection'; connection: Connection }
  | { op: 'remove_connection'; connectionId: string }
  | {
      op: 'update_connection';
      connectionId: string;
      patch: Partial<Pick<Connection, 'protocol' | 'port' | 'label'>> & { props?: Partial<Connection['props']> };
    };

export type ProposalSource = 'user' | 'rule-engine' | 'ai';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'postponed' | 'applied';

export interface ChangeProposal {
  id: string;
  source: ProposalSource;
  title: string;
  rationale: string;
  operations: ModelOperation[];
  status: ProposalStatus;
  /** Revisión del modelo sobre la que se construyó la propuesta. */
  baseRevision: number;
}

// ---------------- Recomendaciones (sección 12) ----------------

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Recommendation {
  id: string;
  problem: string;
  evidence: string;
  evidenceKind: 'simulation' | 'configuration' | 'assumption';
  componentIds: string[];
  risk: string;
  severity: Severity;
  solution: string;
  justification: string;
  benefits: string[];
  tradeoffs: string[];
  complexity: 'low' | 'medium' | 'high';
  costImpact: 'none' | 'low' | 'medium' | 'high';
  priority: 1 | 2 | 3;
  alternatives: string[];
  /** Cambios propuestos (requieren confirmación antes de aplicarse). */
  proposal?: ChangeProposal;
}

export interface ValidationFinding {
  id: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  componentIds: string[];
  connectionId?: string;
}
