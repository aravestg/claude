/** Escenario obligatorio de demostración (sección 24): Usuario → Internet → Firewall → LB → Backend → BD. */
import type { Scenario } from '../contracts';
import type { ArchitectureModel } from '../types';
import { SCHEMA_VERSION } from '../types';

export function demoThreeTierModel(): ArchitectureModel {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'demo-three-tier',
    name: 'Demo: aplicación web de tres capas',
    description: 'Usuario, DNS, Internet, Firewall, Load Balancer, dos instancias de backend y PostgreSQL en una VPC.',
    revision: 0,
    status: 'draft',
    components: [
      { id: 'user', type: 'client.browser', name: 'Usuario', props: { targetHost: 'shop.example.com', sourceIp: '203.0.113.10', timeoutMs: 10000 } },
      { id: 'dns', type: 'network.dns', name: 'DNS', props: { records: [{ host: 'shop.example.com', targetId: 'lb' }] } },
      { id: 'internet', type: 'network.internet', name: 'Internet', props: {} },
      { id: 'fw', type: 'security.firewall', name: 'Firewall perimetral', props: {} },
      { id: 'lb', type: 'network.load_balancer', name: 'Load Balancer', props: {} },
      { id: 'app-1', type: 'compute.app_server', name: 'Backend A (AZ-a)', props: {} },
      { id: 'app-2', type: 'compute.app_server', name: 'Backend B (AZ-b)', props: {} },
      {
        id: 'db',
        type: 'data.postgresql',
        name: 'PostgreSQL',
        props: {
          securityGroup: {
            enabled: true,
            inbound: [
              { id: 'sg-app-1', protocol: 'JDBC', port: 5432, sourceId: 'app-1' },
              { id: 'sg-app-2', protocol: 'JDBC', port: 5432, sourceId: 'app-2' }
            ]
          }
        }
      }
    ],
    connections: [
      { id: 'c-user-dns', sourceId: 'user', targetId: 'dns', protocol: 'DNS', port: 53, props: { latencyMs: 10, encrypted: false } },
      { id: 'c-user-net', sourceId: 'user', targetId: 'internet', protocol: 'HTTPS', port: 443, props: { latencyMs: 20, encrypted: true } },
      { id: 'c-net-fw', sourceId: 'internet', targetId: 'fw', protocol: 'HTTPS', port: 443, props: { latencyMs: 15, encrypted: true } },
      { id: 'c-fw-lb', sourceId: 'fw', targetId: 'lb', protocol: 'HTTPS', port: 443, props: { latencyMs: 1, encrypted: true } },
      { id: 'c-lb-app1', sourceId: 'lb', targetId: 'app-1', protocol: 'HTTP', port: 8080, props: { latencyMs: 1, encrypted: false } },
      { id: 'c-lb-app2', sourceId: 'lb', targetId: 'app-2', protocol: 'HTTP', port: 8080, props: { latencyMs: 1, encrypted: false } },
      { id: 'c-app1-db', sourceId: 'app-1', targetId: 'db', protocol: 'JDBC', port: 5432, props: { latencyMs: 1, encrypted: true } },
      { id: 'c-app2-db', sourceId: 'app-2', targetId: 'db', protocol: 'JDBC', port: 5432, props: { latencyMs: 1, encrypted: true } }
    ],
    groups: [
      { id: 'vpc', kind: 'vpc', name: 'VPC 10.0.0.0/16', memberIds: ['lb', 'app-1', 'app-2', 'db'], props: { cidr: '10.0.0.0/16' } },
      { id: 'sn-public', kind: 'subnet', name: 'Subred pública', parentId: 'vpc', memberIds: ['lb'], props: { cidr: '10.0.0.0/24', public: true } },
      { id: 'sn-app', kind: 'subnet', name: 'Subred privada (app)', parentId: 'vpc', memberIds: ['app-1', 'app-2'], props: { cidr: '10.0.1.0/24', public: false } },
      { id: 'sn-data', kind: 'subnet', name: 'Subred privada (datos)', parentId: 'vpc', memberIds: ['db'], props: { cidr: '10.0.2.0/24', public: false } }
    ],
    layout: {
      positions: {
        user: { x: -15, y: 0, z: 0 },
        dns: { x: -12, y: 0, z: -6 },
        internet: { x: -9, y: 0, z: 0 },
        fw: { x: -4.5, y: 0, z: 0 },
        lb: { x: 0, y: 0, z: 0 },
        'app-1': { x: 5.5, y: 0, z: -3 },
        'app-2': { x: 5.5, y: 0, z: 3 },
        db: { x: 11, y: 0, z: 0 }
      }
    },
    assumptions: [
      'Latencias de red y tiempos de procesamiento son estimaciones conceptuales, no mediciones.',
      'El TLS termina en el Load Balancer; el tráfico interno LB → backend usa HTTP en red privada.',
      'Las solicitudes de un escenario se procesan secuencialmente.'
    ]
  };
}

const baseRequest = {
  method: 'GET' as const,
  path: '/api/orders/1001',
  payload: { orderId: 'ORD-1001', customer: 'cliente-sintético-42' },
  auth: 'valid' as const
};

export function demoThreeTierScenarios(): Scenario[] {
  return [
    {
      id: 'A-success',
      name: 'A · Comunicación exitosa',
      description: 'Una solicitud HTTPS atraviesa DNS, firewall y balanceador, el backend consulta PostgreSQL y el cliente recibe 200.',
      kind: 'success',
      entryComponentId: 'user',
      request: baseRequest,
      requestCount: 1,
      intervalMs: 0,
      faults: [],
      expectation: { outcome: 'success' }
    },
    {
      id: 'B-firewall-block',
      name: 'B · Bloqueo de seguridad (firewall)',
      description: 'Se activa una regla de mayor prioridad que deniega HTTPS/443. El firewall rechaza la conexión.',
      kind: 'block',
      entryComponentId: 'user',
      request: baseRequest,
      requestCount: 1,
      intervalMs: 0,
      faults: [],
      setup: [
        {
          op: 'update_component',
          componentId: 'fw',
          patch: {
            props: {
              rules: [
                { id: 'deny-https-maint', priority: 50, action: 'deny', protocol: 'HTTPS', port: 443, source: '0.0.0.0/0', description: 'Bloqueo por mantención' },
                { id: 'allow-https', priority: 100, action: 'allow', protocol: 'HTTPS', port: 443, source: '0.0.0.0/0', description: 'HTTPS público' }
              ]
            }
          }
        }
      ],
      expectation: { outcome: 'failure' }
    },
    {
      id: 'C-db-down',
      name: 'C · Falla de base de datos',
      description: 'PostgreSQL deja de responder. Tres solicitudes con 20 s de separación muestran timeouts, reintentos y propagación.',
      kind: 'failure',
      entryComponentId: 'user',
      request: baseRequest,
      requestCount: 3,
      intervalMs: 20000,
      faults: [{ kind: 'COMPONENT_DOWN', componentId: 'db' }],
      expectation: { outcome: 'failure' }
    },
    {
      id: 'D-instance-down',
      name: 'D · Caída de una instancia',
      description: 'Backend A cae. El health check del balanceador lo excluye y la solicitud se atiende en Backend B.',
      kind: 'resilience',
      entryComponentId: 'user',
      request: baseRequest,
      requestCount: 2,
      intervalMs: 1000,
      faults: [{ kind: 'COMPONENT_DOWN', componentId: 'app-1' }],
      expectation: { outcome: 'success' }
    },
    {
      id: 'E-sg-misconfig',
      name: 'E · Security Group mal configurado',
      description: 'El Security Group de la BD permite 3306 en lugar de 5432: los paquetes se descartan en silencio y el backend ve timeout.',
      kind: 'block',
      entryComponentId: 'user',
      request: baseRequest,
      requestCount: 1,
      intervalMs: 0,
      faults: [],
      setup: [
        {
          op: 'update_component',
          componentId: 'db',
          patch: {
            props: {
              securityGroup: {
                enabled: true,
                inbound: [
                  { id: 'sg-app-1', protocol: 'TCP', port: 3306, sourceId: 'app-1' },
                  { id: 'sg-app-2', protocol: 'TCP', port: 3306, sourceId: 'app-2' }
                ]
              }
            }
          }
        }
      ],
      expectation: { outcome: 'failure' }
    },
    {
      id: 'F-dns-failure',
      name: 'F · Falla de DNS',
      description: 'El DNS no responde: el cliente nunca llega a abrir la conexión TCP.',
      kind: 'failure',
      entryComponentId: 'user',
      request: baseRequest,
      requestCount: 1,
      intervalMs: 0,
      faults: [{ kind: 'COMPONENT_DOWN', componentId: 'dns' }],
      expectation: { outcome: 'failure' }
    }
  ];
}
