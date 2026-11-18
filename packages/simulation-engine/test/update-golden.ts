/** Regenera la traza golden. Revise el diff en el PR: cambia el comportamiento observable del simulador. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulate } from '../src';
import { prepared } from './helpers';

const { model, scenario } = prepared('demo-three-tier', 'A-success');
const file = join(import.meta.dirname, 'fixtures/demo-A-success.result.json');
writeFileSync(file, JSON.stringify(simulate(model, scenario), null, 2) + '\n');
console.log(`golden actualizado: ${file}`);
