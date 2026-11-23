import { describe, expect, it } from 'vitest';
import { applyOperations, getTemplate } from '@asa/core-model';
import { simulate } from '@asa/simulation-engine';
import { changesOf, chaptersOf, currentChapter, milestonesOf, tagOf } from './lesson';

const run = (id: string) => {
  const t = getTemplate('demo-three-tier');
  const s = t.scenarios().find((x) => x.id === id)!;
  let m = t.model();
  if (s.setup) {
    const r = applyOperations(m, s.setup);
    if (r.ok) m = r.model;
  }
  return simulate(m, s).events;
};

describe('capítulos del stepper', () => {
  it('escenario A: recorrido completo en orden', () => {
    expect(chaptersOf(run('A-success')).map((c) => c.label)).toEqual(['Inicio', 'DNS', 'Conexión', 'Firewall', 'Balanceo', 'Backend', 'Datos', 'Respuesta', 'Resumen']);
  });
  it('escenario B: marca el bloqueo como problema', () => {
    const ch = chaptersOf(run('B-firewall-block'));
    expect(ch.find((c) => c.label === 'Bloqueo')?.status).toBe('error');
  });
  it('escenario C: se compacta a un máximo de capítulos conservando solicitudes y problemas', () => {
    const ch = chaptersOf(run('C-db-down'));
    expect(ch.length).toBeLessThanOrEqual(12);
    expect(ch.filter((c) => c.label.startsWith('Solicitud'))).toHaveLength(3);
    expect(ch.at(-1)?.label).toBe('Resumen');
  });
  it('capítulo actual según el cursor', () => {
    const ch = chaptersOf(run('A-success'));
    expect(currentChapter(ch, -1)).toBe(-1);
    expect(currentChapter(ch, ch[3]!.startSeq)).toBe(3);
  });
});

describe('hitos y narración', () => {
  it('los hitos sólo incluyen lo que ocurre en la simulación', () => {
    const ev = run('A-success');
    const ms = milestonesOf(ev, ev.length - 1);
    expect(ms.every((m) => m.state === 'done')).toBe(true);
    expect(ms.map((m) => m.label)).not.toContain('Autenticar en el gateway');
    expect(milestonesOf(ev, 0).every((m) => m.state === 'pending')).toBe(true);
  });
  it('un bloqueo deja el hito fallido', () => {
    const ev = run('B-firewall-block');
    expect(milestonesOf(ev, ev.length - 1).find((m) => m.label.startsWith('Abrir'))?.state).toBe('failed');
  });
  it('etiquetas y cambios provienen del evento', () => {
    const ev = run('B-firewall-block');
    const denied = ev.find((e) => e.type === 'ACCESS_DENIED')!;
    expect(tagOf(denied)).toEqual({ label: 'Problema', tone: 'problem' });
    expect(changesOf(denied, (id) => id ?? '').map((c) => c.text)).toContain('Regla: deny-https-maint (deny)');
  });
});
