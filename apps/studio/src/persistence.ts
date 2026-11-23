/** Persistencia local (Fase 1). Todo lo leído se valida con el esquema antes de usarse. */
import type { ArchitectureModel, Scenario } from '@asa/core-model';
import { parseModel, parseScenarios } from '@asa/core-model';

const CURRENT = 'asa:current:v1';
const VERSIONS = 'asa:versions:v1';
const MAX_VERSIONS = 20;

export interface SavedVersion {
  id: string;
  label: string;
  savedAt: string;
  templateId: string;
  model: ArchitectureModel;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveCurrent(templateId: string, model: ArchitectureModel, scenarios?: Scenario[]): void {
  write(CURRENT, { templateId, model, ...(scenarios ? { scenarios } : {}) });
}

export function loadCurrent(): { templateId: string; model: ArchitectureModel; scenarios?: Scenario[] } | null {
  const raw = read<{ templateId?: unknown; model?: unknown; scenarios?: unknown }>(CURRENT);
  if (!raw || typeof raw.templateId !== 'string') return null;
  const parsed = parseModel(raw.model);
  if (!parsed.ok) return null;
  if (raw.scenarios !== undefined) {
    const sc = parseScenarios(raw.scenarios);
    if (!sc.ok) return null;
    return { templateId: raw.templateId, model: parsed.value, scenarios: sc.value };
  }
  return { templateId: raw.templateId, model: parsed.value };
}

export function listVersions(): SavedVersion[] {
  const raw = read<SavedVersion[]>(VERSIONS);
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => v && typeof v.id === 'string' && parseModel(v.model).ok);
}

export function saveVersion(templateId: string, model: ArchitectureModel, label: string): SavedVersion | null {
  const v: SavedVersion = { id: `v-${Date.now().toString(36)}`, label: label.slice(0, 80), savedAt: new Date().toISOString(), templateId, model };
  const list = [v, ...listVersions()].slice(0, MAX_VERSIONS);
  return write(VERSIONS, list) ? v : null;
}
