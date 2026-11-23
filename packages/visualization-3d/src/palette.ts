import type { VisualStatus } from './derive';

/** Lenguaje visual consistente (sección 9.1). Siempre acompañado de símbolo y texto. */
export const STATUS_COLOR: Record<VisualStatus, string> = {
  idle: '#8b97a8',
  active: '#3b82f6',
  ok: '#22c55e',
  warning: '#eab308',
  waiting: '#eab308',
  error: '#ef4444',
  down: '#6b7280'
};

export const STATUS_LABEL: Record<VisualStatus, string> = {
  idle: '',
  active: '→ Activo',
  ok: '✔ OK',
  warning: '! Atención',
  waiting: '⏳ Esperando',
  error: '✖ Error',
  down: '⬇ Caído'
};

export const PACKET_COLOR = {
  dns: '#06b6d4',
  syn: '#93c5fd',
  request: '#3b82f6',
  response: '#22c55e',
  query: '#a855f7',
  rst: '#ef4444',
  error: '#ef4444',
  async: '#8a6fd6'
} as const;

export const CATEGORY_COLOR: Record<string, string> = {
  client: '#64748b',
  edge: '#0ea5e9',
  network: '#0ea5e9',
  security: '#f97316',
  compute: '#6366f1',
  integration: '#8b5cf6',
  data: '#14b8a6'
};
