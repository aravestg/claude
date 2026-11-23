import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { flowLayout, getTemplate, importDrawio } from '../src';

describe('disposición por flujo', () => {
  it('ordena la demo de izquierda a derecha siguiendo el tráfico', () => {
    const p = flowLayout(getTemplate('demo-three-tier').model());
    expect(p['user']!.x).toBeLessThan(p['internet']!.x);
    expect(p['internet']!.x).toBeLessThan(p['fw']!.x);
    expect(p['fw']!.x).toBeLessThan(p['lb']!.x);
    expect(p['lb']!.x).toBeLessThan(p['app-1']!.x);
    expect(p['app-1']!.x).toBe(p['app-2']!.x);
    expect(p['app-1']!.x).toBeLessThan(p['db']!.x);
    expect(p['dns']!.z).toBeLessThan(p['user']!.z);
  });
  it('es determinista y no superpone componentes', async () => {
    const r = await importDrawio(readFileSync(join(__dirname, 'fixtures/hybrid-patterns.drawio'), 'utf8'), { inflateRaw: async (b) => new Uint8Array(inflateRawSync(b)) });
    const a = flowLayout(r.model);
    expect(flowLayout(r.model)).toEqual(a);
    const pts = Object.values(a);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(3);
    expect(Object.keys(a).sort()).toEqual(r.model.components.map((c) => c.id).sort());
  });
});
