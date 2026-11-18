import { describe, expect, it } from 'vitest';
import {
  applyOperations,
  applyProposal,
  compatibleProtocols,
  createProposal,
  decideProposal,
  defaultPortFor,
  getDefinition,
  getTemplate,
  listDefinitions,
  parseModel,
  previewProposal,
  ProposalNotApprovedError,
  registerDefinition,
  TEMPLATES,
  toMarkdownReport,
  toMermaid,
  validateModel
} from '../src';

const demo = () => getTemplate('demo-three-tier').model();

describe('catálogo', () => {
  it('cada definición tiene puertos, comportamiento, forma y contenido de aprendizaje', () => {
    for (const d of listDefinitions()) {
      expect(d.behavior).toBeTruthy();
      expect(d.shape).toBeTruthy();
      expect(d.learn.basic && d.learn.advanced).toBeTruthy();
    }
  });
  it('compatibilidad de protocolos y puertos por defecto', () => {
    expect(compatibleProtocols('compute.app_server', 'data.postgresql')).toEqual(['JDBC']);
    expect(compatibleProtocols('client.browser', 'data.postgresql')).toEqual([]);
    expect(defaultPortFor('data.postgresql', 'JDBC')).toBe(5432);
  });
  it('es extensible y rechaza duplicados / desconocidos', () => {
    const base = getDefinition('data.postgresql');
    registerDefinition({ ...base, type: 'data.oracle', label: 'Oracle', inbound: [{ protocol: 'JDBC', port: 1521 }] });
    expect(getDefinition('data.oracle').inbound[0]!.port).toBe(1521);
    expect(() => registerDefinition(base)).toThrow();
    expect(() => getDefinition('nope')).toThrow();
  });
});

describe('operaciones', () => {
  it('aplica atómicamente y aumenta la revisión', () => {
    const m = demo();
    const r = applyOperations(m, [
      { op: 'add_component', component: { id: 'cache', type: 'data.postgresql', name: 'Réplica', props: {} }, position: { x: 1, y: 0, z: 1 } },
      { op: 'add_connection', connection: { id: 'k1', sourceId: 'app-1', targetId: 'cache', protocol: 'JDBC', port: 5432, props: { latencyMs: 1, encrypted: true } } }
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.revision).toBe(1);
    expect(m.components).toHaveLength(8); // original intacto
  });
  it('rechaza todo el lote si una operación es inválida', () => {
    const r = applyOperations(demo(), [
      { op: 'update_component', componentId: 'lb', patch: { name: 'X' } },
      { op: 'add_connection', connection: { id: 'bad', sourceId: 'user', targetId: 'db', protocol: 'JDBC', port: 5432, props: { latencyMs: 1, encrypted: false } } }
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/no acepta JDBC/);
  });
  it('eliminar un componente elimina sus conexiones, membresías y posición', () => {
    const r = applyOperations(demo(), [{ op: 'remove_component', componentId: 'app-1' }]);
    if (!r.ok) throw new Error();
    expect(r.model.connections.some((k) => k.sourceId === 'app-1' || k.targetId === 'app-1')).toBe(false);
    expect(r.model.groups.flatMap((g) => g.memberIds)).not.toContain('app-1');
    expect(r.model.layout.positions['app-1']).toBeUndefined();
  });
  it('valida entradas no confiables (IDs, tipos)', () => {
    const r = applyOperations(demo(), [{ op: 'remove_component', componentId: '<script>' } as never]);
    expect(r.ok).toBe(false);
    expect(applyOperations(demo(), [{ op: 'add_component', component: { id: 'x', type: 'evil.type', name: 'x', props: {} } }]).ok).toBe(false);
    expect(applyOperations(demo(), [{ op: 'update_connection', connectionId: 'c-app1-db', patch: { protocol: 'HTTPS' } }]).ok).toBe(false);
    expect(applyOperations(demo(), [{ op: 'update_connection', connectionId: 'c-app1-db', patch: { props: { latencyMs: 5 } } }]).ok).toBe(true);
    expect(applyOperations(demo(), [{ op: 'remove_connection', connectionId: 'zzz' }]).ok).toBe(false);
  });
});

describe('6. control de cambios: nada se aplica sin aprobación', () => {
  const ops = [{ op: 'update_component' as const, componentId: 'db', patch: { props: { multiAz: true } } }];
  it('una propuesta pendiente no puede aplicarse', () => {
    const m = demo();
    const p = createProposal(m, { id: 'p1', source: 'ai', title: 't', rationale: 'r', operations: ops });
    expect(() => applyProposal(m, p)).toThrow(ProposalNotApprovedError);
    expect(() => applyProposal(m, decideProposal(p, 'rejected'))).toThrow(ProposalNotApprovedError);
    expect(() => applyProposal(m, decideProposal(p, 'postponed'))).toThrow(ProposalNotApprovedError);
  });
  it('previsualizar no modifica el modelo; aprobar sí', () => {
    const m = demo();
    const p = createProposal(m, { id: 'p1', source: 'ai', title: 't', rationale: 'r', operations: ops });
    const prev = previewProposal(m, p);
    expect(prev.ok && prev.model.components.find((c) => c.id === 'db')!.props['multiAz']).toBe(true);
    expect(m.components.find((c) => c.id === 'db')!.props['multiAz']).toBeUndefined();
    const applied = applyProposal(m, decideProposal(p, 'approved'));
    expect(applied.ok).toBe(true);
    expect(applied.proposal.status).toBe('applied');
    expect(() => decideProposal(applied.proposal, 'approved')).toThrow();
  });
  it('una propuesta sobre una revisión obsoleta se rechaza', () => {
    const m = demo();
    const p = decideProposal(createProposal(m, { id: 'p', source: 'ai', title: 't', rationale: 'r', operations: ops }), 'approved');
    const moved = applyOperations(m, [{ op: 'move_component', componentId: 'db', position: { x: 0, y: 0, z: 0 } }]);
    if (!moved.ok) throw new Error();
    expect(applyProposal(moved.model, p).ok).toBe(false);
  });
});

describe('validación estática', () => {
  it('detecta puntos únicos de falla y reintentos sin circuit breaker en la demo', () => {
    const ids = validateModel(demo()).map((f) => f.id);
    expect(ids).toContain('spof:db');
    expect(ids).toContain('no-cb:app-1');
    expect(validateModel(demo()).filter((f) => f.level === 'error')).toEqual([]);
  });
  it('detecta componentes aislados, puertos inesperados, DNS roto y reglas permisivas', () => {
    const m = demo();
    m.components.push({ id: 'lonely', type: 'compute.app_server', name: 'Solo', props: {} });
    m.connections.find((k) => k.id === 'c-app1-db')!.port = 5433;
    m.components.find((c) => c.id === 'dns')!.props = { records: [{ host: 'x', targetId: 'ghost' }] };
    m.components.find((c) => c.id === 'fw')!.props = { rules: [{ id: 'any', priority: 1, action: 'allow', protocol: 'ANY', port: 'ANY', source: '0.0.0.0/0' }] };
    m.connections.push({ id: 'bad', sourceId: 'user', targetId: 'db', protocol: 'JDBC', port: 5432, props: { latencyMs: 1, encrypted: false } });
    const ids = validateModel(m).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['isolated:lonely', 'port:c-app1-db', 'dns-target:dns:x', 'unresolvable:user', 'fw-any:fw:any', 'protocol:bad']));
  });
});

describe('esquema e importación', () => {
  it('acepta todas las plantillas', () => {
    for (const t of TEMPLATES) expect(parseModel(JSON.parse(JSON.stringify(t.model()))).ok).toBe(true);
  });
  it('rechaza entradas malformadas o maliciosas', () => {
    expect(parseModel({}).ok).toBe(false);
    const m = demo() as unknown as Record<string, unknown>;
    expect(parseModel({ ...m, schemaVersion: '9.9' }).ok).toBe(false);
    expect(parseModel({ ...m, components: [{ id: 'a b', type: 'x', name: 'n', props: {} }] }).ok).toBe(false);
    expect(parseModel({ ...m, name: 'x'.repeat(5000) }).ok).toBe(false);
  });
});

describe('exportación', () => {
  it('Mermaid incluye grupos anidados y conexiones con protocolo', () => {
    const md = toMermaid(demo());
    expect(md).toContain('subgraph vpc');
    expect(md).toContain('subgraph sn_app');
    expect(md).toContain('app_1 -->|JDBC:5432| db');
  });
  it('reporte Markdown aclara que es proyección y simulación', () => {
    const md = toMarkdownReport({ model: demo(), findings: validateModel(demo()) });
    expect(md).toContain('simulaciones basadas en reglas');
    expect(md).toContain('```mermaid');
  });
});
