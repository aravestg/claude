/**
 * Architecture Model Engine — tipos del modelo técnico.
 * Fuente única de verdad. Las posiciones 3D viven en `layout` y son SOLO presentación:
 * ningún motor de reglas ni el simulador las lee.
 */

export const SCHEMA_VERSION = '1.0' as const;

export type Protocol = 'HTTPS' | 'HTTP' | 'DNS' | 'JDBC' | 'TCP' | 'SFTP' | 'SSH';
export const PROTOCOLS: readonly Protocol[] = ['HTTPS', 'HTTP', 'DNS', 'JDBC', 'TCP', 'SFTP', 'SSH'];

export type ComponentCategory = 'client' | 'edge' | 'network' | 'security' | 'compute' | 'integration' | 'data';

/** Capas de visualización (sección 15). Ocultar una capa nunca borra datos del modelo. */
export type Layer = 'infrastructure' | 'network' | 'application' | 'integration' | 'data' | 'security';

export type Provider = 'generic' | 'aws' | 'azure' | 'gcp' | 'onprem';

/** Comportamiento técnico que el simulador asocia al tipo de componente. */
export type BehaviorKind =
  | 'client'
  | 'dns'
  | 'transit'
  | 'firewall'
  | 'load_balancer'
  | 'api_gateway'
  | 'service'
  | 'datastore';

/** Forma 3D sugerida. El motor 3D la interpreta; el modelo no sabe cómo se dibuja. */
export type ShapeKind =
  | 'device'
  | 'globe'
  | 'dns'
  | 'wall'
  | 'distributor'
  | 'gateway'
  | 'server'
  | 'function'
  | 'database'
  | 'nosql'
  | 'bucket'
  | 'tunnel'
  | 'key'
  | 'chart'
  | 'mail'
  | 'saas';

export interface PortSpec {
  protocol: Protocol;
  port: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ComponentInstance {
  id: string;
  type: string;
  name: string;
  props: Record<string, unknown>;
}

export interface ConnectionProps {
  /** Latencia lógica estimada del tramo (ms). Es una estimación, no una medición. */
  latencyMs: number;
  encrypted: boolean;
  /** Asíncrona: el llamador despacha el mensaje y no espera respuesta (cola, webhook, email, logs). */
  async?: boolean;
}

export interface Connection {
  id: string;
  sourceId: string;
  targetId: string;
  protocol: Protocol;
  port: number;
  label?: string;
  props: ConnectionProps;
}

export type GroupKind = 'region' | 'availability_zone' | 'vpc' | 'subnet' | 'datacenter';

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  memberIds: string[];
  /** Grupo padre (para anidamiento visual y semántico). */
  parentId?: string;
  props: { cidr?: string; public?: boolean };
}

export interface Layout {
  positions: Record<string, Vec3>;
}

export type ModelStatus = 'draft' | 'approved';

export interface ArchitectureModel {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  /** Incrementa con cada operación aplicada. */
  revision: number;
  status: ModelStatus;
  components: ComponentInstance[];
  connections: Connection[];
  groups: Group[];
  layout: Layout;
  /** Supuestos explícitos (principio P6). */
  assumptions: string[];
}

// ---------- Propiedades tipadas por comportamiento ----------

export interface ClientProps {
  targetHost: string;
  sourceIp: string;
  timeoutMs: number;
}

export interface DnsRecord {
  host: string;
  targetId: string;
}
export interface DnsProps {
  records: DnsRecord[];
  resolveMs: number;
}

export type RuleAction = 'allow' | 'deny';
export interface FirewallRule {
  id: string;
  priority: number;
  action: RuleAction;
  protocol: Protocol | 'ANY';
  port: number | 'ANY';
  /** CIDR de origen. '0.0.0.0/0' = cualquiera. */
  source: string;
  description?: string;
}
export interface FirewallProps {
  defaultAction: RuleAction;
  /** reject: responde RST (el cliente ve "connection refused"). drop: descarta en silencio (el cliente ve timeout). */
  rejectMode: 'reject' | 'drop';
  rules: FirewallRule[];
  inspectMs: number;
}

export interface LoadBalancerProps {
  algorithm: 'round_robin';
  healthChecks: boolean;
  processingMs: number;
  /** Tiempo máximo de espera de respuesta del destino antes de devolver 504 (ms). */
  targetTimeoutMs: number;
}

export interface ApiGatewayProps {
  requireAuth: boolean;
  processingMs: number;
  /** Timeout de la integración antes de devolver 504 (ms). */
  integrationTimeoutMs: number;
}

export interface CircuitBreakerProps {
  enabled: boolean;
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface ServiceProps {
  runtime: string;
  processingMs: number;
  /** Timeout para llamadas a dependencias (ms). */
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
  circuitBreaker: CircuitBreakerProps;
  poolSize: number;
  /** Acciones IAM concedidas al rol de ejecución (p.ej. 'dynamodb:GetItem' o '*'). */
  iamPermissions: string[];
}

export interface SecurityGroupRule {
  id: string;
  protocol: Protocol | 'ANY';
  port: number | 'ANY';
  /** ID de componente origen permitido o 'any'. */
  sourceId: string;
}

export interface DatastoreProps {
  engine: string;
  queryMs: number;
  multiAz: boolean;
  /** Tiempo estimado de failover a la réplica standby (ms). */
  failoverMs: number;
  securityGroup: { enabled: boolean; inbound: SecurityGroupRule[] };
  requiresIam: boolean;
  requiredAction: string;
}
