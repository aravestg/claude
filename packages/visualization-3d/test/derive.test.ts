/**
 * El renderizador representa correctamente eventos PREGRABADOS (sección 10.6, punto 3):
 * se usa la traza golden del simulador, sin ejecutar el simulador ni WebGL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SimulationEvent, SimulationResult } from '@asa/core-model';
import { advancePlayhead, deriveSceneState, displayWeight } from '../src/derive';

const golden = JSON.parse(readFileSync(join(__dirname, '../../simulation-engine/test/fixtures/demo-A-success.result.json'), 'utf8')) as SimulationResult;
const events = golden.events;
const idx = (type: string, from = 0) => events.findIndex((e, i) => i >= from && e.type === type);

describe('deriveSceneState con eventos pregrabados', () => {
  it('estado vacío antes de empezar', () => {
    expect(deriveSceneState(events, -1)).toEqual({ components: {}, connections: {} });
  });
  it('una transferencia en curso produce un paquete sobre la conexión correcta', () => {
    const i = idx('DNS_RESOLUTION_STARTED');
    const s = deriveSceneState(events, i, 0.5);
    expect(s.packet).toMatchObject({ connectionId: 'c-user-dns', fromId: 'user', toId: 'dns', progress: 0.5, variant: 'dns' });
    expect(s.focusId).toBe('dns');
  });
  it('al completar la transferencia no hay paquete y el destino queda activo', () => {
    const i = idx('DNS_RESOLUTION_STARTED');
    const s = deriveSceneState(events, i, 1);
    expect(s.packet).toBeUndefined();
    expect(s.components['dns']?.status).toBe('active');
    expect(s.connections['c-user-dns']).toEqual({ status: 'active', traversed: true });
  });
  it('al final todo el camino queda en verde y el cliente OK', () => {
    const s = deriveSceneState(events, events.length - 1, 1);
    expect(s.components['user']?.status).toBe('ok');
    expect(s.connections['c-user-net']?.status).toBe('ok');
    expect(s.connections['c-app1-db']?.status).toBe('ok');
    expect(s.connections['c-lb-app2']).toBeUndefined(); // nunca se usó
  });
  it('retroceder recalcula de forma idempotente', () => {
    const mid = idx('BACKEND_SELECTED');
    const a = deriveSceneState(events, mid, 1);
    deriveSceneState(events, events.length - 1, 1);
    expect(deriveSceneState(events, mid, 1)).toEqual(a);
  });
  it('representa un bloqueo y una caída a partir de eventos sintéticos del contrato', () => {
    const base = { simulationId: 's', duration: 0, traceId: 't', data: {}, message: '', explanation: { basic: '', advanced: '' }, observableInRealSystem: true, provenance: 'simulation:rule-based' as const };
    const evs: SimulationEvent[] = [
      { ...base, id: '0', seq: 0, t: 0, type: 'FAULT_INJECTED', kind: 'state', status: 'warning', sourceId: 'db', data: { fault: { kind: 'COMPONENT_DOWN', componentId: 'db' } } },
      { ...base, id: '1', seq: 1, t: 0, type: 'REQUEST_STARTED', kind: 'state', status: 'info', sourceId: 'user' },
      { ...base, id: '2', seq: 2, t: 1, type: 'ACCESS_DENIED', kind: 'state', status: 'error', sourceId: 'fw' }
    ];
    const s = deriveSceneState(evs, 2);
    expect(s.components['db']).toEqual({ status: 'down', badge: '⬇ Caído' });
    expect(s.components['fw']).toEqual({ status: 'error', badge: '⛔ Denegado' });
    // el RST que sale del firewall no borra el punto de bloqueo
    evs.push({ ...base, id: '3', seq: 3, t: 1, type: 'CONNECTION_REFUSED', kind: 'transfer', status: 'error', sourceId: 'fw', targetId: 'internet', connectionId: 'c-net-fw', duration: 15 });
    const after = deriveSceneState(evs, 3, 1);
    expect(after.components['fw']).toEqual({ status: 'error', badge: '⛔ Denegado' });
    expect(after.connections['c-net-fw']?.status).toBe('error');
  });
});

describe('advancePlayhead', () => {
  it('avanza por pesos y termina en el último evento', () => {
    let st = { cursor: 0, progress: 0, finished: false };
    const total = events.reduce((s, e) => s + displayWeight(e), 0);
    st = advancePlayhead(events, st.cursor, st.progress, total / 2);
    expect(st.finished).toBe(false);
    st = advancePlayhead(events, st.cursor, st.progress, total);
    expect(st).toEqual({ cursor: events.length - 1, progress: 1, finished: true });
  });
  it('avance pequeño dentro de una transferencia', () => {
    const i = idx('REQUEST_SENT');
    const r = advancePlayhead(events, i, 0, 0.25);
    expect(r).toEqual({ cursor: i, progress: 0.25, finished: false });
  });
});
