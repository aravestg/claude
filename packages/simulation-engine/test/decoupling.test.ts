/**
 * Pruebas de desacoplamiento (sección 10.6) y reproducibilidad (criterios 5, 17, 18).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyOperations } from '@asa/core-model';
import { simulate } from '../src';
import { prepared } from './helpers';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('1. el simulador funciona sin interfaz gráfica', () => {
  it('no importa React, Three.js, WebGL ni APIs del DOM', () => {
    const forbidden = /from ['"](react|react-dom|three|@react-three\/[^'"]+|@asa\/visualization-3d)['"]|\b(window|document|requestAnimationFrame|WebGLRenderingContext)\b/;
    for (const file of [...sources(join(__dirname, '../src')), ...sources(join(__dirname, '../../core-model/src'))]) {
      if (file.endsWith('cli.ts')) continue;
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }
  });
  it('no declara dependencias gráficas', () => {
    for (const pkg of ['../package.json', '../../core-model/package.json']) {
      const json = JSON.parse(readFileSync(join(__dirname, pkg), 'utf8'));
      const deps = Object.keys({ ...json.dependencies, ...json.devDependencies });
      expect(deps.filter((d) => /react|three|vite/.test(d)), pkg).toEqual([]);
    }
  });
  it('no usa fuentes de no-determinismo', () => {
    for (const file of sources(join(__dirname, '../src'))) {
      if (file.endsWith('cli.ts')) continue;
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/Math\.random|Date\.now|new Date\(|performance\.now/);
    }
  });
});

describe('2/18. escenarios reproducibles', () => {
  it('dos ejecuciones producen eventos idénticos', () => {
    const { model, scenario } = prepared('demo-three-tier', 'C-db-down');
    expect(JSON.stringify(simulate(model, scenario))).toBe(JSON.stringify(simulate(model, scenario)));
  });
  it('coincide con la traza pregrabada (golden file)', () => {
    const { model, scenario } = prepared('demo-three-tier', 'A-success');
    const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures/demo-A-success.result.json'), 'utf8'));
    expect(simulate(model, scenario)).toEqual(golden);
  });
});

describe('5/17. posiciones 3D y cámara no alteran el resultado técnico', () => {
  it('mover todos los componentes no cambia ni un evento', () => {
    const { model, scenario } = prepared('demo-three-tier', 'B-firewall-block');
    const ops = model.components.map((c, i) => ({ op: 'move_component' as const, componentId: c.id, position: { x: i * 37 - 100, y: i % 3, z: -i * 13 } }));
    const moved = applyOperations(model, ops);
    if (!moved.ok) throw new Error();
    expect(moved.model.revision).toBe(model.revision + 1);
    const a = simulate(model, scenario);
    const b = simulate(moved.model, scenario);
    expect({ ...b, modelRevision: 0 }).toEqual({ ...a, modelRevision: 0 });
  });
  it('el modelo no contiene estado de cámara y el simulador ignora layout', () => {
    const { model, scenario } = prepared('demo-three-tier', 'A-success');
    const noLayout = { ...model, layout: { positions: {} } };
    expect(simulate(noLayout, scenario).events).toEqual(simulate(model, scenario).events);
  });
});

describe('7. los eventos son reutilizables en otras interfaces', () => {
  it('son JSON serializable sin pérdida', () => {
    const { model, scenario } = prepared('serverless-api', 'A-success');
    const r = simulate(model, scenario);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it('cada evento tiene los campos del contrato (sección 7.4)', () => {
    const { model, scenario } = prepared('demo-three-tier', 'C-db-down');
    const r = simulate(model, scenario);
    const ids = new Set<string>();
    for (const e of r.events) {
      expect(e.id).toBeTruthy();
      expect(e.simulationId).toBe(r.simulationId);
      expect(typeof e.t).toBe('number');
      expect(e.traceId).toBeTruthy();
      expect(e.explanation.basic && e.explanation.advanced).toBeTruthy();
      if (e.causedBy) expect(ids.has(e.causedBy)).toBe(true);
      ids.add(e.id);
    }
  });
});
