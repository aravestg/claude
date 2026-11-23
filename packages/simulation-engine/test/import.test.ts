/** Un diagrama draw.io importado debe ser simulable de punta a punta con el motor real. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { applyOperations, importDrawio } from '@asa/core-model';
import { diagnose, simulate } from '../src';

const inflateRaw = async (b: Uint8Array) => new Uint8Array(inflateRawSync(b));
const fx = (f: string) => readFileSync(join(__dirname, '../../core-model/test/fixtures', f), 'utf8');

describe('simulación de diagramas importados', async () => {
  const aws = await importDrawio(fx('aws-three-tier.drawio'), { inflateRaw });
  const run = (id: string) => {
    const s = aws.scenarios.find((x) => x.id === id)!;
    let m = aws.model;
    if (s.setup) {
      const r = applyOperations(m, s.setup);
      if (!r.ok) throw new Error(r.errors.join());
      m = r.model;
    }
    return { r: simulate(m, s), m };
  };
  it('AWS: el flujo principal llega a la base de datos y responde 200', () => {
    const { r } = run('imp-A-main');
    expect(r.outcome).toBe('success');
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['DNS_RESOLVED', 'RULE_EVALUATED', 'BACKEND_SELECTED', 'DATABASE_QUERY_COMPLETED']));
  });
  it('AWS: la caída de la BD falla con causa raíz en la BD y recomendaciones', () => {
    const { r, m } = run('imp-B-store-down');
    expect(r.outcome).toBe('failure');
    expect(diagnose(m, r).map((x) => x.id)).toEqual(expect.arrayContaining([expect.stringMatching(/^multiaz:/)]));
  });
  it('AWS: la caída de una instancia se absorbe con health checks', () => {
    expect(run('imp-C-instance-down').r.outcome).toBe('success');
  });
  it('AWS: el bloqueo en el WAF se detecta en el lugar correcto', () => {
    const { r } = run('imp-D-fw-block');
    expect(r.outcome).toBe('failure');
    expect(r.events.find((e) => e.type === 'ACCESS_DENIED')?.data.ruleId).toBe('deny-https-test');
  });
  it('genérico comprimido: cliente → internet → gateway → servicio → BD responde 200', async () => {
    const xml = fx('generic.xml');
    const g = await importDrawio(`<mxfile><diagram id="a" name="x">${deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64')}</diagram></mxfile>`, { inflateRaw });
    expect(simulate(g.model, g.scenarios[0]!).outcome).toBe('success');
  });
});

describe('simulación del diagrama híbrido', async () => {
  const h = await importDrawio(fx('hybrid-patterns.drawio'), { inflateRaw });
  const sc = (k: string) => h.scenarios.find((s) => s.id.includes(k))!;
  it('el flujo principal pasa por VPN, ALB, frontend, backend, endpoints e integración y responde 200', () => {
    const r = simulate(h.model, sc('main'));
    expect(r.outcome).toBe('success');
    const path = r.requests[0]!.path;
    for (const n of ['direct-connect-vpn', 'alb-interno', 'frontend-ecs-fargate', 'backend-ecs-fargate', 'rds-postgresql', 'endpoint-secrets', 'secrets-manager', 'hr-exp-api', 'sistema-de-rr-hh']) expect(path.some((p) => p.startsWith(n)), n).toBe(true);
  });
  it('la caída de la VPN, de la BD o de un SaaS falla con la causa en el lugar correcto', () => {
    for (const [k, at] of [['vpn-down', 'direct-connect-vpn'], ['store-down', 'rds-postgresql'], ['saas-down', '']] as const) {
      const r = simulate(h.model, sc(k));
      expect(r.outcome, k).toBe('failure');
      const root = r.events.find((e) => e.id === r.requests[0]!.rootCauseEventId)!;
      expect(root.type).toBe('SERVICE_UNAVAILABLE');
      if (at) expect(root.sourceId).toBe(at);
    }
  });
});

describe('diagnóstico según el tipo de dependencia', async () => {
  const h = await importDrawio(fx('hybrid-patterns.drawio'), { inflateRaw });
  it('para un SaaS caído recomienda aislamiento, no Multi-AZ', () => {
    const s = h.scenarios.find((x) => x.id.includes('saas-down'))!;
    const ids = diagnose(h.model, simulate(h.model, s)).map((r) => r.id);
    expect(ids.some((i) => i.startsWith('external:'))).toBe(true);
    expect(ids.some((i) => i.startsWith('multiaz:'))).toBe(false);
  });
});
