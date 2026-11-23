/**
 * Estado de interfaz (Zustand). El modelo sólo cambia mediante ModelOperation (applyOperations),
 * con historial para deshacer/rehacer. La simulación se pide al worker; la visualización deriva
 * del resultado. Ningún estado de cámara/UI entra al modelo.
 */
import { create } from 'zustand';
import type { ArchitectureModel, ChangeProposal, ModelOperation, Recommendation, Scenario, SimulationResult } from '@asa/core-model';
import { applyOperations, applyProposal, createProposal, decideProposal, getTemplate, parseModel, TEMPLATES } from '@asa/core-model';
import type { CameraRequest, CameraViewName, LayerKey, Selection, Tool, VisualStyle } from '@asa/visualization-3d';
import { advancePlayhead } from '@asa/visualization-3d';
import { loadCurrent, saveCurrent } from './persistence';
import { rebaseIfSafe } from './rebase';
import { runSimulation } from './sim/client';

export type RightTab = 'step' | 'events' | 'recommendations' | 'inspector' | 'learn' | 'validation';
export type Mode = 'simulate' | 'design';
export type RecDecision = 'accepted' | 'rejected' | 'postponed';

export interface RunSummary {
  label: string;
  scenarioId: string;
  modelRevision: number;
  outcome: SimulationResult['outcome'];
  ok: number;
  total: number;
  durationMs: number;
  errors: number;
  rootCauses: string[];
}

interface StudioState {
  templateId: string;
  model: ArchitectureModel;
  past: ArchitectureModel[];
  future: ArchitectureModel[];
  scenarios: Scenario[];
  scenarioId: string;
  selection: Selection;
  tool: Tool;
  connectFrom: string | null;
  hiddenLayers: Set<LayerKey>;
  theme: 'dark' | 'light';
  level: 'basic' | 'advanced';
  quality: 'high' | 'low';
  visualStyle: VisualStyle;
  follow: boolean;
  camera: CameraRequest;
  rightTab: RightTab;
  mode: Mode;
  progress_: Record<string, SimulationResult['outcome']>;
  result: SimulationResult | null;
  resultRevision: number;
  runtime: string;
  running: boolean;
  recommendations: Recommendation[];
  recDecisions: Record<string, RecDecision>;
  runs: RunSummary[];
  cursor: number;
  progress: number;
  playing: boolean;
  speed: number;
  pendingProposal: ChangeProposal | null;
  toast: { kind: 'info' | 'error' | 'success'; text: string; id: number } | null;

  apply: (ops: ModelOperation[], label?: string) => boolean;
  undo: () => void;
  redo: () => void;
  loadTemplate: (id: string) => void;
  loadModel: (model: ArchitectureModel, templateId: string, label: string) => void;
  importJson: (text: string) => void;
  setScenario: (id: string) => void;
  openScenario: (templateId: string, scenarioId: string) => void;
  setMode: (m: Mode) => void;
  prepareScenario: () => void;
  simulate: () => Promise<void>;
  play: () => void;
  pause: () => void;
  stop: () => void;
  restart: () => void;
  step: (dir: 1 | -1) => void;
  seek: (cursor: number) => void;
  tick: (dtSeconds: number) => void;
  setSpeed: (s: number) => void;
  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  pickConnect: (id: string) => string | null;
  toggleLayer: (l: LayerKey) => void;
  setCamera: (v: CameraViewName) => void;
  set: (p: Partial<Pick<StudioState, 'theme' | 'level' | 'quality' | 'follow' | 'rightTab' | 'visualStyle'>>) => void;
  propose: (p: ChangeProposal) => void;
  decide: (decision: 'approved' | 'rejected' | 'postponed') => void;
  decideRecommendation: (id: string, d: RecDecision) => void;
  notify: (kind: 'info' | 'error' | 'success', text: string) => void;
}

const MAX_HISTORY = 100;

function initial(): { templateId: string; model: ArchitectureModel } {
  const saved = typeof localStorage !== 'undefined' ? loadCurrent() : null;
  if (saved && TEMPLATES.some((t) => t.id === saved.templateId)) return saved;
  return { templateId: 'demo-three-tier', model: getTemplate('demo-three-tier').model() };
}

function summarize(label: string, r: SimulationResult): RunSummary {
  const roots = r.requests
    .filter((q) => !q.ok && q.rootCauseEventId)
    .map((q) => r.events.find((e) => e.id === q.rootCauseEventId))
    .map((e) => (e ? `${e.type}@${e.sourceId ?? ''}` : ''));
  return {
    label,
    scenarioId: r.scenarioId,
    modelRevision: r.modelRevision,
    outcome: r.outcome,
    ok: r.requests.filter((q) => q.ok).length,
    total: r.requests.length,
    durationMs: r.requests.reduce((s, q) => s + (q.finishedAt - q.startedAt), 0),
    errors: r.events.filter((e) => e.status === 'error').length,
    rootCauses: [...new Set(roots)]
  };
}

const init = initial();

export const useStudio = create<StudioState>((set, get) => ({
  templateId: init.templateId,
  model: init.model,
  past: [],
  future: [],
  scenarios: getTemplate(init.templateId).scenarios(),
  scenarioId: getTemplate(init.templateId).scenarios()[0]!.id,
  selection: null,
  tool: 'select',
  connectFrom: null,
  hiddenLayers: new Set(),
  theme: 'light',
  level: 'basic',
  quality: 'high',
  visualStyle: 'illustrated',
  follow: false,
  camera: { view: 'perspective', nonce: 0 },
  rightTab: 'step',
  mode: 'simulate',
  progress_: {},
  result: null,
  resultRevision: -1,
  runtime: '',
  running: false,
  recommendations: [],
  recDecisions: {},
  runs: [],
  cursor: -1,
  progress: 0,
  playing: false,
  speed: 1,
  pendingProposal: null,
  toast: null,

  apply: (ops, label) => {
    const { model, past } = get();
    const r = applyOperations(model, ops);
    if (!r.ok) {
      get().notify('error', `No se aplicó el cambio: ${r.errors[0]}`);
      return false;
    }
    const sel = get().selection;
    const stillThere = !sel || (sel.kind === 'component' ? r.model.components.some((c) => c.id === sel.id) : r.model.connections.some((k) => k.id === sel.id));
    set({ model: r.model, past: [...past, model].slice(-MAX_HISTORY), future: [], selection: stillThere ? sel : null });
    saveCurrent(get().templateId, r.model);
    if (label) get().notify('success', label);
    return true;
  },
  undo: () => {
    const { past, model, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ model: prev, past: past.slice(0, -1), future: [model, ...future] });
    saveCurrent(get().templateId, prev);
  },
  redo: () => {
    const { past, model, future } = get();
    const next = future[0];
    if (!next) return;
    set({ model: next, past: [...past, model], future: future.slice(1) });
    saveCurrent(get().templateId, next);
  },
  loadTemplate: (id) => {
    const t = getTemplate(id);
    get().loadModel(t.model(), id, `Plantilla cargada: ${t.name}`);
  },
  loadModel: (model, templateId, label) => {
    const scenarios = getTemplate(templateId).scenarios();
    set({
      model,
      templateId,
      past: [...get().past, get().model].slice(-MAX_HISTORY),
      future: [],
      scenarios,
      scenarioId: scenarios[0]!.id,
      selection: null,
      result: null,
      recommendations: [],
      recDecisions: {},
      runs: [],
      cursor: -1,
      progress: 0,
      playing: false,
      camera: { view: 'perspective', nonce: get().camera.nonce + 1 }
    });
    saveCurrent(templateId, model);
    get().notify('info', label);
  },
  importJson: (text) => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      get().notify('error', 'El archivo no es JSON válido.');
      return;
    }
    const payload = (data as { model?: unknown })?.model ?? data;
    const parsed = parseModel(payload);
    if (!parsed.ok) {
      get().notify('error', `Modelo inválido: ${parsed.errors[0]}`);
      return;
    }
    const tpl = TEMPLATES.find((t) => t.id === parsed.value.id)?.id ?? get().templateId;
    get().loadModel(parsed.value, tpl, `Modelo importado: ${parsed.value.name}`);
  },
  setScenario: (id) => set({ scenarioId: id, playing: false, result: null, cursor: -1, progress: 0 }),
  openScenario: (templateId, scenarioId) => {
    if (templateId !== get().templateId) {
      if (get().past.length && !confirm('¿Cambiar de plantilla? Los cambios quedan en el historial (Ctrl+Z).')) return;
      get().loadTemplate(templateId);
    }
    get().setScenario(scenarioId);
    set({ mode: 'simulate', rightTab: 'step' });
  },
  setMode: (mode) => set({ mode, rightTab: mode === 'design' ? 'inspector' : 'step', tool: 'select', connectFrom: null }),
  prepareScenario: () => {
    const s = get().scenarios.find((x) => x.id === get().scenarioId);
    if (!s?.setup?.length) return;
    get().propose(
      createProposal(get().model, {
        id: `setup-${s.id}`,
        source: 'user',
        title: `Configuración del escenario: ${s.name}`,
        rationale: s.description,
        operations: s.setup
      })
    );
  },
  simulate: async () => {
    const { model, scenarios, scenarioId } = get();
    const scenario = scenarios.find((x) => x.id === scenarioId);
    if (!scenario) return;
    set({ running: true, playing: false });
    try {
      const out = await runSimulation(model, scenario);
      const n = get().runs.length + 1;
      set({
        result: out.result,
        resultRevision: model.revision,
        runtime: `${out.runtime} · ${out.elapsedMs.toFixed(1)} ms`,
        recommendations: out.recommendations,
        recDecisions: {},
        runs: [...get().runs, summarize(`#${n} rev.${model.revision}`, out.result)].slice(-6),
        progress_: { ...get().progress_, [`${get().templateId}:${scenario.id}`]: out.result.outcome },
        cursor: 0,
        progress: 0,
        playing: true,
        running: false
      });
    } catch (err) {
      set({ running: false });
      get().notify('error', `Falló la simulación: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  play: () => {
    const { result, cursor, progress } = get();
    if (!result) return void get().simulate();
    const atEnd = cursor >= result.events.length - 1 && progress >= 1;
    set({ playing: true, ...(atEnd || cursor < 0 ? { cursor: 0, progress: 0 } : {}) });
  },
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, cursor: -1, progress: 0 }),
  restart: () => set({ playing: !!get().result, cursor: 0, progress: 0 }),
  step: (dir) => {
    const { result, cursor, progress } = get();
    if (!result) return;
    const n = result.events.length;
    if (dir === 1) {
      if (cursor >= 0 && progress < 1) set({ progress: 1, playing: false });
      else set({ cursor: Math.min(n - 1, cursor + 1), progress: 1, playing: false });
    } else set({ cursor: Math.max(0, cursor - 1), progress: 1, playing: false });
  },
  seek: (cursor) => set({ cursor, progress: 1, playing: false }),
  tick: (dt) => {
    const { result, cursor, progress, speed, playing } = get();
    if (!result || !playing) return;
    const r = advancePlayhead(result.events, cursor, progress, dt * speed * 1.7);
    set({ cursor: r.cursor, progress: r.progress, playing: !r.finished });
  },
  setSpeed: (speed) => set({ speed }),
  select: (selection) => set({ selection, ...(selection && get().mode === 'design' ? { rightTab: get().rightTab === 'validation' ? 'inspector' : get().rightTab } : {}) }),
  setTool: (tool) => set({ tool, connectFrom: null }),
  pickConnect: (id) => {
    const from = get().connectFrom;
    if (!from) {
      set({ connectFrom: id });
      return null;
    }
    set({ connectFrom: null });
    return from === id ? null : from;
  },
  toggleLayer: (l) => {
    const s = new Set(get().hiddenLayers);
    if (s.has(l)) s.delete(l);
    else s.add(l);
    set({ hiddenLayers: s });
  },
  setCamera: (view) => set({ camera: { view, nonce: get().camera.nonce + 1 } }),
  set: (p) => set(p),
  propose: (p) => set({ pendingProposal: p }),
  decide: (decision) => {
    const p = get().pendingProposal;
    if (!p) return;
    const decided = decideProposal(p, decision);
    if (decision !== 'approved') {
      set({ pendingProposal: null });
      get().notify('info', decision === 'rejected' ? 'Propuesta rechazada.' : 'Propuesta pospuesta.');
      return;
    }
    const { model, past } = get();
    const r = applyProposal(model, rebaseIfSafe(decided, model, past));
    if (!r.ok) {
      get().notify('error', r.errors[0] ?? 'No se pudo aplicar');
      return;
    }
    set({ model: r.model, past: [...past, model].slice(-MAX_HISTORY), future: [], pendingProposal: null });
    saveCurrent(get().templateId, r.model);
    get().notify('success', `Aplicado: ${p.title}. Vuelva a simular para comprobar el efecto.`);
  },
  decideRecommendation: (id, d) => set({ recDecisions: { ...get().recDecisions, [id]: d } }),
  notify: (kind, text) => set({ toast: { kind, text, id: Date.now() } })
}));
