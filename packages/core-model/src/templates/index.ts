import type { Scenario } from '../contracts';
import type { ArchitectureModel } from '../types';
import { demoThreeTierModel, demoThreeTierScenarios } from './demo-three-tier';
import { serverlessApiModel, serverlessApiScenarios } from './serverless-api';

export interface Template {
  id: string;
  name: string;
  description: string;
  model: () => ArchitectureModel;
  scenarios: () => Scenario[];
}

export const TEMPLATES: Template[] = [
  { id: 'demo-three-tier', name: 'Aplicación web de tres capas (demo)', description: 'Escenario obligatorio de demostración.', model: demoThreeTierModel, scenarios: demoThreeTierScenarios },
  { id: 'serverless-api', name: 'API Gateway + Función + NoSQL', description: 'Serverless con autorización IAM.', model: serverlessApiModel, scenarios: serverlessApiScenarios }
];

export function getTemplate(id: string): Template {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Plantilla desconocida: ${id}`);
  return t;
}
