/** Persistencia local (Fase 1). Todo lo leído se valida con el esquema antes de usarse. */
import type { ArchitectureModel } from '@asa/core-model';
import { parseModel } from '@asa/core-model';

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

export function saveCurrent(templateId: string, model: ArchitectureModel): void {
  write(CURRENT, { templateId, model });
}

export function loadCurrent(): { templateId: string; model: ArchitectureModel } | null {
  const raw = read<{ templateId?: unknown; model?: unknown }>(CURRENT);
  if (!raw || typeof raw.templateId !== 'string') return null;
  const parsed = parseModel(raw.model);
  return parsed.ok ? { templateId: raw.templateId, model: parsed.value } : null;
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
