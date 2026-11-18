import { describe, expect, it } from 'vitest';
import { applyOperations, TEMPLATES } from '@asa/core-model';
import { diagnose, simulate } from '../src';
import { prepared, types } from './helpers';

describe('todas las plantillas cumplen la expectativa de sus escenarios', () => {
  for (const t of TEMPLATES) {
    for (const s of t.scenarios()) {
      it(`${t.id} / ${s.id}`, () => {
        const { model, scenario } = prepared(t.id, s.id);
        const r = simulate(model, scenario);
        expect(r.outcome).toBe(scenario.expectation?.outcome);
        expect(r.events.at(-1)?.type).toBe('SIMULATION_COMPLETED');
        // tiempo lógico monótono no decreciente
        for (let i = 1; i < r.events.length; i++) expect(r.events[i]!.t).toBeGreaterThanOrEqual(r.events[i - 1]!.t);
        // cada evento de error identifica dónde ocurre
        for (const e of r.events.filter((x) => x.status === 'error' && x.traceId !== 'trace-system')) expect(e.sourceId).toBeTruthy();
      });
    }
  }
});

describe('Escenario A — comunicación exitosa (sección 24)', () => {
  const { model, scenario } = prepared('demo-three-tier', 'A-success');
  const r = simulate(model, scenario);
  it('recorre la secuencia esperada', () => {
    const seq = types(r.events);
    const order = ['REQUEST_STARTED', 'DNS_RESOLVED', 'RULE_EVALUATED', 'CONNECTION_ESTABLISHED', 'TLS_HANDSHAKE_COMPLETED', 'BACKEND_SELECTED', 'PROCESSING_STARTED', 'DATABASE_QUERY_STARTED', 'DATABASE_QUERY_COMPLETED', 'RESPONSE_RECEIVED'];
    let last = -1;
    for (const t of order) {
      const idx = seq.indexOf(t as never, last + 1);
      expect(idx, t).toBeGreaterThan(last);
      last = idx;
    }
  });
  it('responde 200 y atraviesa todos los componentes', () => {
    expect(r.requests[0]).toMatchObject({ ok: true, httpStatus: 200 });
    expect(r.requests[0]!.path).toEqual(expect.arrayContaining(['user', 'dns', 'internet', 'fw', 'lb', 'app-1', 'db']));
  });
  it('las transferencias referencian conexiones reales del modelo', () => {
    const ids = new Set(model.connections.map((k) => k.id));
    for (const e of r.events.filter((x) => x.kind === 'transfer')) {
      expect(ids.has(e.connectionId!)).toBe(true);
      expect(e.duration).toBeGreaterThan(0);
    }
  });
  it('marca la procedencia como simulación y no como medición', () => {
    expect(r.provenance.mode).toBe('simulation:rule-based');
    expect(r.events.every((e) => e.provenance === 'simulation:rule-based')).toBe(true);
  });
});

describe('Escenario B — bloqueo de seguridad', () => {
  const { model, scenario } = prepared('demo-three-tier', 'B-firewall-block');
  const r = simulate(model, scenario);
  it('el bloqueo aparece en el firewall con la regla causante', () => {
    const root = r.events.find((e) => e.id === r.requests[0]!.rootCauseEventId)!;
    expect(root).toMatchObject({ type: 'ACCESS_DENIED', sourceId: 'fw', failure: 'network' });
    expect(root.data.ruleId).toBe('deny-https-maint');
  });
  it('el tráfico nunca llega al balanceador ni al backend', () => {
    expect(r.events.some((e) => e.targetId === 'lb' || e.sourceId === 'app-1')).toBe(false);
  });
  it('corregir la regla con la propuesta y re-ejecutar restablece el servicio', () => {
    const rec = diagnose(model, r)[0]!;
    expect(rec.proposal?.status).toBe('pending');
    const fixed = applyOperations(model, rec.proposal!.operations);
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(simulate(fixed.model, scenario).outcome).toBe('success');
  });
  it('en modo drop el cliente sólo observa timeout', () => {
    const fw = model.components.find((c) => c.id === 'fw')!;
    const m = applyOperations(model, [{ op: 'update_component', componentId: 'fw', patch: { props: { ...fw.props, rejectMode: 'drop' } } }]);
    if (!m.ok) throw new Error();
    const r2 = simulate(m.model, scenario);
    expect(types(r2.events)).toContain('CONNECTION_TIMEOUT');
    expect(types(r2.events)).not.toContain('CONNECTION_REFUSED');
  });
});

describe('Escenario C — falla de base de datos', () => {
  const { model, scenario } = prepared('demo-three-tier', 'C-db-down');
  const before = simulate(model, scenario);
  it('muestra intentos, timeouts y reintentos con backoff', () => {
    const t = types(before.events);
    expect(t.filter((x) => x === 'RETRY_STARTED')).toHaveLength(6);
    expect(before.requests.every((r) => r.httpStatus === 503 && r.failure === 'availability')).toBe(true);
    const retries = before.events.filter((e) => e.type === 'RETRY_STARTED').slice(0, 2);
    expect(retries.map((e) => e.data.backoffMs)).toEqual([200, 400]);
  });
  it('identifica la BD como causa raíz y la propagación hacia el usuario', () => {
    const root = before.events.find((e) => e.id === before.requests[0]!.rootCauseEventId)!;
    expect(root).toMatchObject({ type: 'SERVICE_UNAVAILABLE', sourceId: 'db' });
    expect(before.affectedComponentIds).toEqual(expect.arrayContaining(['db', 'app-1', 'user']));
  });
  it('aplicar Multi-AZ + circuit breaker mejora el resultado (antes/después)', () => {
    let m = model;
    const recs = diagnose(model, before);
    expect(recs.map((r) => r.id)).toEqual(expect.arrayContaining(['multiaz:db', 'cb:db']));
    for (const rec of recs) {
      const res = applyOperations(m, rec.proposal!.operations);
      if (res.ok) m = res.model;
    }
    const after = simulate(m, scenario);
    expect(after.outcome).toBe('partial');
    expect(types(after.events)).toEqual(expect.arrayContaining(['FAILOVER_STARTED', 'FAILOVER_COMPLETED', 'CIRCUIT_BREAKER_OPENED', 'CIRCUIT_BREAKER_CLOSED']));
    expect(after.requests.at(-1)).toMatchObject({ ok: true, httpStatus: 200 });
  });
  it('con circuit breaker abierto la siguiente solicitud falla rápido', () => {
    const m = applyOperations(model, [
      { op: 'update_component', componentId: 'app-1', patch: { props: { circuitBreaker: { enabled: true, failureThreshold: 2, resetTimeoutMs: 60000 } } } },
      { op: 'update_component', componentId: 'app-2', patch: { props: { circuitBreaker: { enabled: true, failureThreshold: 2, resetTimeoutMs: 60000 } } } }
    ]);
    if (!m.ok) throw new Error();
    const s = { ...scenario, requestCount: 3, intervalMs: 100 };
    const r = simulate(m.model, s);
    expect(types(r.events)).toContain('CIRCUIT_BREAKER_REJECTED');
    const third = r.requests[2]!;
    expect(third.finishedAt - third.startedAt).toBeLessThan(1000);
  });
});

describe('fallas diferenciadas', () => {
  it('instancia caída: el health check la excluye y responde la otra', () => {
    const { model, scenario } = prepared('demo-three-tier', 'D-instance-down');
    const r = simulate(model, scenario);
    expect(types(r.events)).toContain('HEALTH_CHECK_FAILED');
    expect(r.events.filter((e) => e.type === 'BACKEND_SELECTED').every((e) => e.data.target === 'app-2')).toBe(true);
  });
  it('sin health checks el balanceador enruta a la instancia caída y responde 504', () => {
    const { model, scenario } = prepared('demo-three-tier', 'D-instance-down');
    const m = applyOperations(model, [{ op: 'update_component', componentId: 'lb', patch: { props: { healthChecks: false } } }]);
    if (!m.ok) throw new Error();
    const r = simulate(m.model, scenario);
    expect(r.outcome).toBe('partial');
    expect(r.requests[0]!.httpStatus).toBe(504);
    expect(diagnose(m.model, r).map((x) => x.id)).toContain('hc:lb');
  });
  it('Security Group: descarte silencioso (no observable) → timeout en el backend', () => {
    const { model, scenario } = prepared('demo-three-tier', 'E-sg-misconfig');
    const r = simulate(model, scenario);
    const drop = r.events.find((e) => e.type === 'PACKET_DROPPED')!;
    expect(drop).toMatchObject({ sourceId: 'db', failure: 'network', observableInRealSystem: false });
    const rec = diagnose(model, r).find((x) => x.id === 'sg-drop:db')!;
    const fixed = applyOperations(model, rec.proposal!.operations);
    if (!fixed.ok) throw new Error();
    expect(simulate(fixed.model, scenario).outcome).toBe('success');
  });
  it('DNS caído: nunca se abre TCP', () => {
    const { model, scenario } = prepared('demo-three-tier', 'F-dns-failure');
    const r = simulate(model, scenario);
    expect(types(r.events)).toContain('DNS_RESOLUTION_FAILED');
    expect(types(r.events)).not.toContain('CONNECTION_ATTEMPTED');
    expect(r.requests[0]!.failure).toBe('dns');
  });
  it('IAM: autorización denegada sin reintentos (403 → 500)', () => {
    const { model, scenario } = prepared('serverless-api', 'C-iam-denied');
    const r = simulate(model, scenario);
    expect(r.events.find((e) => e.type === 'ACCESS_DENIED')).toMatchObject({ sourceId: 'table', failure: 'authorization' });
    expect(types(r.events)).not.toContain('RETRY_STARTED');
    expect(r.requests[0]!.httpStatus).toBe(500);
    const rec = diagnose(model, r)[0]!;
    const fixed = applyOperations(model, rec.proposal!.operations);
    if (!fixed.ok) throw new Error();
    expect(simulate(fixed.model, scenario).outcome).toBe('success');
  });
  it('autenticación fallida: 401 sin invocar la función', () => {
    const { model, scenario } = prepared('serverless-api', 'B-auth-failure');
    const r = simulate(model, scenario);
    expect(r.requests[0]!.httpStatus).toBe(401);
    expect(r.events.some((e) => e.sourceId === 'fn')).toBe(false);
  });
  it('throttling 429 y pool agotado', () => {
    const t = prepared('serverless-api', 'D-throttling');
    expect(simulate(t.model, t.scenario).requests[0]!.httpStatus).toBe(429);
    const a = prepared('demo-three-tier', 'A-success');
    const r = simulate(a.model, { ...a.scenario, faults: [{ kind: 'POOL_EXHAUSTED', componentId: 'app-1' }] });
    expect(types(r.events)).toContain('POOL_EXHAUSTED');
    expect(r.requests[0]!.failure).toBe('capacity');
  });
  it('error de aplicación inyectado (500) y latencia extra', () => {
    const a = prepared('demo-three-tier', 'A-success');
    const r = simulate(a.model, { ...a.scenario, faults: [{ kind: 'HTTP_ERROR', componentId: 'app-1', status: 500 }] });
    expect(r.requests[0]!.httpStatus).toBe(500);
    const slow = simulate(a.model, { ...a.scenario, faults: [{ kind: 'EXTRA_LATENCY', connectionId: 'c-user-net', extraMs: 500 }] });
    expect(slow.requests[0]!.finishedAt).toBeGreaterThan(simulate(a.model, a.scenario).requests[0]!.finishedAt + 500 * 4);
  });
});
