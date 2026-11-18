import type { ArchitectureModel, Scenario } from '@asa/core-model';
import { applyOperations, getTemplate } from '@asa/core-model';

export function prepared(templateId: string, scenarioId: string): { model: ArchitectureModel; scenario: Scenario } {
  const t = getTemplate(templateId);
  const scenario = t.scenarios().find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(scenarioId);
  let model = t.model();
  if (scenario.setup) {
    const r = applyOperations(model, scenario.setup);
    if (!r.ok) throw new Error(r.errors.join());
    model = r.model;
  }
  return { model, scenario };
}

export const types = (events: { type: string }[]) => events.map((e) => e.type);
