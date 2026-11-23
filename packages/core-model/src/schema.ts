/**
 * Esquemas zod para validar entradas no confiables (importación de archivos, respuestas de IA,
 * almacenamiento local). Toda entrada externa pasa por aquí antes de llegar al modelo.
 */
import { z } from 'zod';
import { PROTOCOLS, SCHEMA_VERSION } from './types';
import type { ArchitectureModel } from './types';
import type { ModelOperation, Scenario } from './contracts';

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_.:-]+$/, 'ID inválido: sólo letras, dígitos y _ . : -');
const text = (max: number) => z.string().max(max);
const protocol = z.enum(PROTOCOLS as [string, ...string[]]);
const vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

// props: objeto JSON acotado (sin funciones, profundidad razonable)
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue).max(200), z.record(z.string(), jsonValue)])
);
const props = z.record(z.string(), jsonValue);

export const componentSchema = z.object({ id, type: text(80), name: text(120), props });
export const connectionSchema = z.object({
  id,
  sourceId: id,
  targetId: id,
  protocol,
  port: z.number().int().min(1).max(65535),
  label: text(120).optional(),
  props: z.object({ latencyMs: z.number().min(0).max(600000), encrypted: z.boolean() })
});
export const groupSchema = z.object({
  id,
  kind: z.enum(['region', 'availability_zone', 'vpc', 'subnet', 'datacenter']),
  name: text(120),
  memberIds: z.array(id).max(1000),
  parentId: id.optional(),
  props: z.object({ cidr: text(43).optional(), public: z.boolean().optional() })
});

export const modelSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  name: text(200),
  description: text(4000),
  revision: z.number().int().min(0),
  status: z.enum(['draft', 'approved']),
  components: z.array(componentSchema).max(2000),
  connections: z.array(connectionSchema).max(5000),
  groups: z.array(groupSchema).max(500),
  layout: z.object({ positions: z.record(z.string(), vec3) }),
  assumptions: z.array(text(500)).max(100)
});

export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_component'), component: componentSchema, position: vec3.optional() }),
  z.object({ op: z.literal('remove_component'), componentId: id }),
  z.object({
    op: z.literal('update_component'),
    componentId: id,
    patch: z.object({ name: text(120).optional(), props: props.optional() })
  }),
  z.object({ op: z.literal('move_component'), componentId: id, position: vec3 }),
  z.object({ op: z.literal('add_connection'), connection: connectionSchema }),
  z.object({ op: z.literal('remove_connection'), connectionId: id }),
  z.object({
    op: z.literal('update_connection'),
    connectionId: id,
    patch: z.object({
      protocol: protocol.optional(),
      port: z.number().int().min(1).max(65535).optional(),
      label: text(120).optional(),
      props: z.object({ latencyMs: z.number().min(0).max(600000).optional(), encrypted: z.boolean().optional() }).optional()
    })
  })
]);

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function fmt(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`);
}

export function parseModel(input: unknown): ParseResult<ArchitectureModel> {
  const r = modelSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data as ArchitectureModel } : { ok: false, errors: fmt(r.error) };
}

export function parseOperations(input: unknown): ParseResult<ModelOperation[]> {
  const r = z.array(operationSchema).max(500).safeParse(input);
  return r.success ? { ok: true, value: r.data as ModelOperation[] } : { ok: false, errors: fmt(r.error) };
}

const faultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('COMPONENT_DOWN'), componentId: id, fromT: z.number().min(0).optional(), untilT: z.number().min(0).optional() }),
  z.object({ kind: z.literal('HTTP_ERROR'), componentId: id, status: z.union([z.literal(401), z.literal(403), z.literal(404), z.literal(429), z.literal(500), z.literal(503)]) }),
  z.object({ kind: z.literal('POOL_EXHAUSTED'), componentId: id }),
  z.object({ kind: z.literal('EXTRA_LATENCY'), connectionId: id, extraMs: z.number().min(0).max(600000) })
]);

export const scenarioSchema = z.object({
  id,
  name: text(160),
  description: text(2000),
  kind: z.enum(['success', 'block', 'failure', 'resilience', 'custom']),
  entryComponentId: id,
  request: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    path: text(500),
    payload: z.record(z.string(), jsonValue),
    auth: z.enum(['valid', 'missing', 'invalid'])
  }),
  requestCount: z.number().int().min(1).max(50),
  intervalMs: z.number().min(0).max(3600000),
  faults: z.array(faultSchema).max(50),
  setup: z.array(operationSchema).max(100).optional(),
  expectation: z.object({ outcome: z.enum(['success', 'failure', 'partial']) }).optional()
});

export function parseScenarios(input: unknown): ParseResult<Scenario[]> {
  const r = z.array(scenarioSchema).max(50).safeParse(input);
  return r.success ? { ok: true, value: r.data as Scenario[] } : { ok: false, errors: fmt(r.error) };
}
