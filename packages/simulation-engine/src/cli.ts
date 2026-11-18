/**
 * CLI headless: demuestra que el simulador funciona sin interfaz gráfica.
 *   pnpm sim                          → lista plantillas y escenarios
 *   pnpm sim demo-three-tier A-success [--json] [--setup]
 */
import { applyOperations, getTemplate, TEMPLATES } from '@asa/core-model';
import { diagnose, simulate } from './index';

const [templateId, scenarioId, ...flags] = process.argv.slice(2);
if (!templateId || !scenarioId) {
  for (const t of TEMPLATES) {
    console.log(`${t.id} — ${t.name}`);
    for (const s of t.scenarios()) console.log(`   ${s.id.padEnd(20)} ${s.name}`);
  }
  console.log('\nUso: pnpm sim <plantilla> <escenario> [--json] [--no-setup]');
  process.exit(0);
}
const tpl = getTemplate(templateId);
const scenario = tpl.scenarios().find((s) => s.id === scenarioId);
if (!scenario) {
  console.error(`Escenario desconocido: ${scenarioId}`);
  process.exit(2);
}
let model = tpl.model();
if (scenario.setup && !flags.includes('--no-setup')) {
  const r = applyOperations(model, scenario.setup);
  if (!r.ok) {
    console.error(r.errors.join('\n'));
    process.exit(2);
  }
  model = r.model;
}
const result = simulate(model, scenario);
if (flags.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const icon = { info: '·', active: '→', success: '✔', warning: '!', error: '✖' } as const;
  for (const e of result.events) console.log(`${String(e.t).padStart(7)} ms  ${icon[e.status]} ${e.type.padEnd(26)} ${e.message}`);
  console.log(`\nResultado: ${result.outcome}  (${result.simulationId})`);
  for (const r of diagnose(model, result)) console.log(`  [P${r.priority}/${r.severity}] ${r.problem} → ${r.solution}`);
  console.log(`\n${result.provenance.disclaimer}`);
}
process.exit(result.outcome === 'success' || flags.includes('--json') ? 0 : 1);
