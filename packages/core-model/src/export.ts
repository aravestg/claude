/**
 * Exportaciones 2D/texto. Son PROYECCIONES del modelo: no conservan navegación ni animación 3D.
 */
import { getDefinition, hasDefinition } from './catalog';
import type { Recommendation, SimulationResult, ValidationFinding } from './contracts';
import type { ArchitectureModel } from './types';

const safe = (s: string) => s.replace(/["`<>]/g, "'");
const mid = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

export function toMermaid(model: ArchitectureModel): string {
  const lines = ['%% Proyección 2D generada desde el modelo (sin capacidades 3D)', 'flowchart LR'];
  const grouped = new Set<string>();
  const roots = model.groups.filter((g) => !g.parentId);
  const emitGroup = (gid: string, indent: string) => {
    const g = model.groups.find((x) => x.id === gid)!;
    lines.push(`${indent}subgraph ${mid(g.id)}["${safe(g.name)}"]`);
    for (const child of model.groups.filter((x) => x.parentId === g.id)) emitGroup(child.id, indent + '  ');
    const childMembers = new Set(model.groups.filter((x) => x.parentId === g.id).flatMap((x) => x.memberIds));
    for (const id of g.memberIds.filter((m) => !childMembers.has(m))) {
      const c = model.components.find((x) => x.id === id);
      if (c) {
        lines.push(`${indent}  ${mid(c.id)}["${safe(c.name)}"]`);
        grouped.add(c.id);
      }
    }
    lines.push(`${indent}end`);
  };
  for (const g of roots) emitGroup(g.id, '  ');
  for (const c of model.components.filter((x) => !grouped.has(x.id))) lines.push(`  ${mid(c.id)}["${safe(c.name)}"]`);
  for (const k of model.connections) lines.push(`  ${mid(k.sourceId)} -->|${k.protocol}:${k.port}| ${mid(k.targetId)}`);
  return lines.join('\n') + '\n';
}

export function toMarkdownReport(input: {
  model: ArchitectureModel;
  findings: ValidationFinding[];
  result?: SimulationResult;
  recommendations?: Recommendation[];
}): string {
  const { model, findings, result, recommendations = [] } = input;
  const out: string[] = [];
  out.push(`# ${model.name}`, '', model.description, '');
  out.push('> Documento generado automáticamente desde el modelo arquitectónico (rev. ' + model.revision + ').');
  out.push('> Los resultados de simulación son **simulaciones basadas en reglas**, no mediciones reales.', '');
  out.push('## Supuestos', '', ...model.assumptions.map((a) => `- ${a}`), '');
  out.push('## Componentes', '', '| ID | Nombre | Tipo | Tecnología | Equivalentes |', '|---|---|---|---|---|');
  for (const c of model.components) {
    const d = hasDefinition(c.type) ? getDefinition(c.type) : undefined;
    const eq = d ? Object.entries(d.equivalents).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
    out.push(`| ${c.id} | ${c.name} | ${d?.label ?? c.type} | ${d?.technology ?? ''} | ${eq} |`);
  }
  out.push('', '## Conectividad', '', '| Origen | Destino | Protocolo | Puerto | Cifrado | Latencia estimada |', '|---|---|---|---|---|---|');
  for (const k of model.connections) out.push(`| ${k.sourceId} | ${k.targetId} | ${k.protocol} | ${k.port} | ${k.props.encrypted ? 'sí' : 'no'} | ${k.props.latencyMs} ms |`);
  out.push('', '## Diagrama lógico (Mermaid, proyección 2D)', '', '```mermaid', toMermaid(model).trimEnd(), '```', '');
  out.push('## Hallazgos de validación', '');
  out.push(...(findings.length ? findings.map((f) => `- **${f.level}** — ${f.message}`) : ['- Sin hallazgos.']), '');
  if (result) {
    out.push('## Resultado de simulación', '');
    out.push(`- Simulación: \`${result.simulationId}\` · escenario \`${result.scenarioId}\` · resultado **${result.outcome}**`);
    out.push(`- ${result.provenance.disclaimer}`, '');
    out.push('| # | Traza | Estado | HTTP | Duración lógica | Causa |', '|---|---|---|---|---|---|');
    for (const r of result.requests)
      out.push(`| ${r.index + 1} | ${r.traceId} | ${r.ok ? 'OK' : 'FALLA'} | ${r.httpStatus ?? '-'} | ${r.finishedAt - r.startedAt} ms | ${r.error ?? ''} |`);
    out.push('', '### Secuencia de eventos', '', '| t (ms) | Evento | Origen → Destino | Mensaje |', '|---|---|---|---|');
    for (const e of result.events) out.push(`| ${e.t} | ${e.type} | ${e.sourceId ?? ''}${e.targetId ? ' → ' + e.targetId : ''} | ${e.message.replace(/\|/g, '/')} |`);
    out.push('');
  }
  if (recommendations.length) {
    out.push('## Recomendaciones', '');
    for (const r of recommendations) {
      out.push(`### ${r.problem}`, '', `- Severidad: ${r.severity} · Prioridad: ${r.priority} · Complejidad: ${r.complexity} · Impacto en costo: ${r.costImpact}`);
      out.push(`- Evidencia (${r.evidenceKind}): ${r.evidence}`, `- Solución: ${r.solution}`, `- Justificación: ${r.justification}`);
      out.push(`- Trade-offs: ${r.tradeoffs.join('; ')}`, `- Alternativas: ${r.alternatives.join('; ')}`, '');
    }
  }
  return out.join('\n');
}
