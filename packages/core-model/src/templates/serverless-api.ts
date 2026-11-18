/** Plantilla 3: API Gateway + función serverless + NoSQL (autorización IAM). */
import type { Scenario } from '../contracts';
import type { ArchitectureModel } from '../types';
import { SCHEMA_VERSION } from '../types';

export function serverlessApiModel(): ArchitectureModel {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'serverless-api',
    name: 'API serverless: Gateway + Función + NoSQL',
    description: 'API pública con autenticación en el gateway, función serverless y tabla clave-valor autorizada por IAM.',
    revision: 0,
    status: 'draft',
    components: [
      { id: 'user', type: 'client.browser', name: 'Cliente', props: { targetHost: 'api.example.com', sourceIp: '198.51.100.7', timeoutMs: 10000 } },
      { id: 'dns', type: 'network.dns', name: 'DNS', props: { records: [{ host: 'api.example.com', targetId: 'apigw' }] } },
      { id: 'internet', type: 'network.internet', name: 'Internet', props: {} },
      { id: 'apigw', type: 'integration.api_gateway', name: 'API Gateway', props: {} },
      { id: 'fn', type: 'compute.function', name: 'Función getOrder', props: { iamPermissions: ['dynamodb:GetItem'] } },
      { id: 'table', type: 'data.nosql', name: 'Tabla Orders', props: {} }
    ],
    connections: [
      { id: 'c-user-dns', sourceId: 'user', targetId: 'dns', protocol: 'DNS', port: 53, props: { latencyMs: 10, encrypted: false } },
      { id: 'c-user-net', sourceId: 'user', targetId: 'internet', protocol: 'HTTPS', port: 443, props: { latencyMs: 20, encrypted: true } },
      { id: 'c-net-gw', sourceId: 'internet', targetId: 'apigw', protocol: 'HTTPS', port: 443, props: { latencyMs: 15, encrypted: true } },
      { id: 'c-gw-fn', sourceId: 'apigw', targetId: 'fn', protocol: 'HTTPS', port: 443, props: { latencyMs: 3, encrypted: true } },
      { id: 'c-fn-table', sourceId: 'fn', targetId: 'table', protocol: 'HTTPS', port: 443, props: { latencyMs: 2, encrypted: true } }
    ],
    groups: [{ id: 'region', kind: 'region', name: 'Región cloud', memberIds: ['apigw', 'fn', 'table'], props: {} }],
    layout: {
      positions: {
        user: { x: -12, y: 0, z: 0 },
        dns: { x: -9, y: 0, z: -6 },
        internet: { x: -6, y: 0, z: 0 },
        apigw: { x: -1, y: 0, z: 0 },
        fn: { x: 4, y: 0, z: 0 },
        table: { x: 9, y: 0, z: 0 }
      }
    },
    assumptions: ['Latencias estimadas.', 'No se modelan cold starts en esta versión.']
  };
}

const req = { method: 'GET' as const, path: '/orders/1001', payload: { orderId: 'ORD-1001' }, auth: 'valid' as const };

export function serverlessApiScenarios(): Scenario[] {
  return [
    { id: 'A-success', name: 'A · Invocación exitosa', description: 'Token válido, la función lee la tabla y responde 200.', kind: 'success', entryComponentId: 'user', request: req, requestCount: 1, intervalMs: 0, faults: [], expectation: { outcome: 'success' } },
    { id: 'B-auth-failure', name: 'B · Token inválido (401)', description: 'El gateway rechaza la solicitud antes de invocar la función.', kind: 'block', entryComponentId: 'user', request: { ...req, auth: 'invalid' }, requestCount: 1, intervalMs: 0, faults: [], expectation: { outcome: 'failure' } },
    {
      id: 'C-iam-denied',
      name: 'C · Permiso IAM ausente (403)',
      description: 'Se retira dynamodb:GetItem del rol de la función: la tabla responde AccessDenied.',
      kind: 'block',
      entryComponentId: 'user',
      request: req,
      requestCount: 1,
      intervalMs: 0,
      faults: [],
      setup: [{ op: 'update_component', componentId: 'fn', patch: { props: { iamPermissions: [] } } }],
      expectation: { outcome: 'failure' }
    },
    { id: 'D-throttling', name: 'D · Throttling (429)', description: 'El gateway alcanza su cuota y responde 429.', kind: 'failure', entryComponentId: 'user', request: req, requestCount: 1, intervalMs: 0, faults: [{ kind: 'HTTP_ERROR', componentId: 'apigw', status: 429 }], expectation: { outcome: 'failure' } }
  ];
}
