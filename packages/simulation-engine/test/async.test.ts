/** Comunicación asíncrona: el emisor no espera; la caída del destino no afecta al usuario pero se registra. */
import { describe, expect, it } from 'vitest';
import { applyOperations } from '@asa/core-model';
import { diagnose, simulate } from '../src';
import { prepared, types } from './helpers';

function withEmail(asyncFlag: boolean) {
  const { model, scenario } = prepared('demo-three-tier', 'A-success');
  const r = applyOperations(model, [
    { op: 'add_component', component: { id: 'mail', type: 'integration.email', name: 'Email', props: {} } },
    { op: 'add_connection', connection: { id: 'c-app1-mail', sourceId: 'app-1', targetId: 'mail', protocol: 'HTTPS', port: 443, props: { latencyMs: 5, encrypted: true, ...(asyncFlag ? { async: true } : {}) } } }
  ]);
  if (!r.ok) throw new Error(r.errors.join());
  return { model: r.model, scenario: { ...scenario, faults: [{ kind: 'COMPONENT_DOWN' as const, componentId: 'mail' }] } };
}

describe('llamadas asíncronas', () => {
  it('síncrona: la caída del email tumba la solicitud', () => {
    const { model, scenario } = withEmail(false);
    expect(simulate(model, scenario).outcome).toBe('failure');
  });
  it('asíncrona: la solicitud responde 200 y la pérdida queda registrada después', () => {
    const { model, scenario } = withEmail(true);
    const r = simulate(model, scenario);
    expect(r.outcome).toBe('success');
    const t = types(r.events);
    expect(t).toContain('ASYNC_DISPATCHED');
    expect(t).toContain('ASYNC_DELIVERY_FAILED');
    expect(t.indexOf('ASYNC_DELIVERY_FAILED')).toBeGreaterThan(t.indexOf('ASYNC_DISPATCHED'));
    const disp = r.events.find((e) => e.type === 'ASYNC_DISPATCHED')!;
    expect(disp).toMatchObject({ kind: 'transfer', connectionId: 'c-app1-mail' });
    expect(diagnose(model, r).map((x) => x.id)).toContain('async-loss:mail');
  });
  it('asíncrona sin falla: se entrega en segundo plano', () => {
    const { model, scenario } = withEmail(true);
    const r = simulate(model, { ...scenario, faults: [] });
    expect(types(r.events)).toContain('ASYNC_DELIVERED');
    expect(r.outcome).toBe('success');
  });
  it('sigue siendo determinista', () => {
    const { model, scenario } = withEmail(true);
    expect(JSON.stringify(simulate(model, scenario))).toBe(JSON.stringify(simulate(model, scenario)));
  });
});
