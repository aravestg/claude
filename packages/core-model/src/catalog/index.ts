import type { ComponentDefinition } from './definitions';
import { DEFINITIONS } from './definitions';
import type { Protocol } from '../types';

export type { ComponentDefinition, LearnContent } from './definitions';

const registry = new Map<string, ComponentDefinition>(DEFINITIONS.map((d) => [d.type, d]));

export function listDefinitions(): ComponentDefinition[] {
  return [...registry.values()];
}

export function getDefinition(type: string): ComponentDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Tipo de componente desconocido en el catálogo: ${type}`);
  return def;
}

export function hasDefinition(type: string): boolean {
  return registry.has(type);
}

/** Punto de extensión: registrar definiciones adicionales (plugins de catálogo). */
export function registerDefinition(def: ComponentDefinition): void {
  if (registry.has(def.type)) throw new Error(`El tipo ${def.type} ya está registrado`);
  registry.set(def.type, def);
}

/** Puerto por defecto que acepta `targetType` para `protocol`, si existe. */
export function defaultPortFor(targetType: string, protocol: Protocol): number | undefined {
  return getDefinition(targetType).inbound.find((p) => p.protocol === protocol)?.port;
}

/** Protocolos compatibles entre un origen y un destino según el catálogo. */
export function compatibleProtocols(sourceType: string, targetType: string): Protocol[] {
  const src = getDefinition(sourceType);
  const dst = getDefinition(targetType);
  const accepted = new Set(dst.inbound.map((p) => p.protocol));
  return src.outboundProtocols.filter((p) => accepted.has(p));
}
