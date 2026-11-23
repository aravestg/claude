/**
 * Importador de diagramas draw.io (diagrams.net) → ArchitectureModel + escenarios.
 *
 * Fase 1 `readDrawio` + `analyzeDrawioPage`: decodifica (XML plano, comprimido deflate+base64
 * o .drawio.svg) y clasifica figuras. Fase 2 `buildFromAnalysis`: construye el modelo aplicando
 * las correcciones del usuario y completa lo mínimo para poder simular, registrando cada
 * completado como SUPUESTO (principio P6). El resultado se valida con el esquema zod.
 */
import { compatibleProtocols, defaultPortFor, getDefinition, hasDefinition } from '../catalog';
import type { Scenario } from '../contracts';
import { parseModel } from '../schema';
import type { ArchitectureModel, ComponentInstance, Connection, Group, GroupKind, Protocol, Vec3 } from '../types';
import { SCHEMA_VERSION } from '../types';
import { classify, groupKindOf, protocolFromLabel } from './mapping';
import type { XmlNode } from './xml';
import { base64ToBytes, decodeEntities, findAll, parseXml, utf8Decode, XmlError } from './xml';

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>;

export interface DrawioPage {
  id: string;
  name: string;
  graph: XmlNode;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedNode {
  cellId: string;
  label: string;
  rect: Rect;
  /** Tipo sugerido (undefined = no reconocido). */
  type: string | undefined;
  confidence: 'alta' | 'media' | 'baja' | 'ninguna';
  by: 'estilo' | 'texto' | 'por defecto';
  styleHint: string;
}

export interface DetectedGroup {
  cellId: string;
  label: string;
  kind: GroupKind;
  rect: Rect;
}

export interface DetectedEdge {
  cellId: string;
  source: string;
  target: string;
  label: string;
}

export interface DrawioAnalysis {
  pageName: string;
  nodes: DetectedNode[];
  groups: DetectedGroup[];
  edges: DetectedEdge[];
  skipped: { cellId: string; label: string; reason: string }[];
}

export interface ImportReport {
  pageName: string;
  components: { id: string; cellId: string; name: string; type: string; confidence: string; by: string }[];
  connections: { id: string; from: string; to: string; protocol: Protocol; port: number; note?: string }[];
  groups: { id: string; name: string; kind: GroupKind; members: number }[];
  skipped: { cellId: string; label: string; reason: string }[];
  assumptions: string[];
  warnings: string[];
}

export interface DrawioImportResult {
  model: ArchitectureModel;
  scenarios: Scenario[];
  report: ImportReport;
}

export class DrawioImportError extends Error {}

// ---------------------------------------------------------------- lectura

export async function readDrawio(input: string, opts: { inflateRaw: InflateRaw }): Promise<DrawioPage[]> {
  let text = input.trim();
  if (/^<svg[\s>]/i.test(text) || text.startsWith('<?xml') && /<svg[\s>]/i.test(text.slice(0, 500))) {
    const m = text.match(/\scontent="([^"]*)"/);
    if (!m) throw new DrawioImportError('El SVG no contiene un diagrama draw.io embebido (exporte con "Incluir copia del diagrama").');
    text = decodeEntities(m[1]!);
  }
  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch (e) {
    throw new DrawioImportError(e instanceof XmlError ? e.message : 'El archivo no es XML válido');
  }
  const diagrams = findAll(root, 'diagram');
  const pages: DrawioPage[] = [];
  if (diagrams.length) {
    for (const [i, d] of diagrams.entries()) {
      let graph = d.children.find((c) => c.name === 'mxGraphModel');
      if (!graph) {
        const payload = d.text.trim();
        if (!payload) continue;
        graph = await decompressPage(payload, opts.inflateRaw);
      }
      pages.push({ id: d.attrs['id'] ?? `page-${i + 1}`, name: d.attrs['name'] || `Página ${i + 1}`, graph });
    }
  } else {
    const graph = findAll(root, 'mxGraphModel')[0];
    if (graph) pages.push({ id: 'page-1', name: 'Página 1', graph });
  }
  if (!pages.length) throw new DrawioImportError('No se encontró ningún diagrama draw.io (mxGraphModel) en el archivo.');
  return pages;
}

async function decompressPage(payload: string, inflateRaw: InflateRaw): Promise<XmlNode> {
  let xml: string;
  try {
    const raw = utf8Decode(await inflateRaw(base64ToBytes(payload)));
    try {
      xml = decodeURIComponent(raw);
    } catch {
      xml = raw;
    }
  } catch {
    throw new DrawioImportError('No se pudo descomprimir la página del diagrama.');
  }
  const graph = findAll(parseXml(xml), 'mxGraphModel')[0];
  if (!graph) throw new DrawioImportError('La página comprimida no contiene un mxGraphModel.');
  return graph;
}

// ---------------------------------------------------------------- análisis

interface Cell {
  id: string;
  label: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  parent: string;
  source?: string;
  target?: string;
  geo?: Rect;
}

const stripHtml = (s: string) =>
  decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(div|p|li)>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

function collectCells(graph: XmlNode): Cell[] {
  const out: Cell[] = [];
  const visit = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === 'mxCell' || c.name === 'object' || c.name === 'UserObject') {
        const cell = c.name === 'mxCell' ? c : c.children.find((x) => x.name === 'mxCell');
        if (!cell) continue;
        const id = c.attrs['id'] ?? cell.attrs['id'];
        if (!id) continue;
        const geoNode = cell.children.find((x) => x.name === 'mxGeometry');
        const num = (v?: string) => (v === undefined || v === '' ? 0 : Number(v));
        const geo = geoNode ? { x: num(geoNode.attrs['x']), y: num(geoNode.attrs['y']), w: num(geoNode.attrs['width']), h: num(geoNode.attrs['height']) } : undefined;
        const entry: Cell = {
          id,
          label: stripHtml(c.attrs['label'] ?? cell.attrs['value'] ?? ''),
          style: cell.attrs['style'] ?? '',
          vertex: cell.attrs['vertex'] === '1',
          edge: cell.attrs['edge'] === '1',
          parent: cell.attrs['parent'] ?? ''
        };
        if (cell.attrs['source']) entry.source = cell.attrs['source'];
        if (cell.attrs['target']) entry.target = cell.attrs['target'];
        if (geo && [geo.x, geo.y, geo.w, geo.h].every(Number.isFinite)) entry.geo = geo;
        out.push(entry);
      } else visit(c);
    }
  };
  visit(graph);
  return out;
}

const inside = (a: Rect, b: Rect) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function analyzeDrawioPage(page: DrawioPage): DrawioAnalysis {
  const cells = collectCells(page.graph);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = new Map<string, Rect>();
  const absOf = (c: Cell, depth = 0): Rect | undefined => {
    if (!c.geo || depth > 50) return undefined;
    const cached = abs.get(c.id);
    if (cached) return cached;
    const parent = byId.get(c.parent);
    const pr = parent && parent.vertex ? absOf(parent, depth + 1) : undefined;
    const r = { x: c.geo.x + (pr?.x ?? 0), y: c.geo.y + (pr?.y ?? 0), w: c.geo.w, h: c.geo.h };
    abs.set(c.id, r);
    return r;
  };
  const skipped: DrawioAnalysis['skipped'] = [];
  const edgeIds = new Set(cells.filter((c) => c.edge).map((c) => c.id));
  const vertices = cells.filter((c) => c.vertex && !edgeIds.has(c.parent));
  const candidates: { cell: Cell; rect: Rect }[] = [];
  for (const v of vertices) {
    const rect = absOf(v);
    const st = v.style.toLowerCase();
    if (!rect || rect.w <= 0 || rect.h <= 0) continue;
    if (/^text;|;text;|^text$|edgelabel/.test(st)) {
      if (v.label) skipped.push({ cellId: v.id, label: v.label, reason: 'Texto libre (anotación)' });
      continue;
    }
    candidates.push({ cell: v, rect });
  }
  const containsOthers = (r: Rect, self: string) => candidates.some((o) => o.cell.id !== self && inside(o.rect, r) && o.rect.w * o.rect.h < r.w * r.h * 0.6);

  const groups: DetectedGroup[] = [];
  const nodes: DetectedNode[] = [];
  for (const { cell, rect } of candidates) {
    const st = cell.style.toLowerCase();
    const looksGroup = /container=1|swimlane|aws4\.group|groupcenter|gricon=|mxgraph\.(azure|gcp2?)\..*group/.test(st);
    const kind = groupKindOf(cell.style, cell.label);
    const cls = classify(cell.style, cell.label);
    if ((looksGroup || (kind && !(cls?.by === 'estilo'))) && containsOthers(rect, cell.id)) {
      groups.push({ cellId: cell.id, label: cell.label, kind: kind ?? 'region', rect });
      continue;
    }
    if (!cls && containsOthers(rect, cell.id)) {
      groups.push({ cellId: cell.id, label: cell.label, kind: 'region', rect });
      continue;
    }
    if (!cls && !cell.label) {
      skipped.push({ cellId: cell.id, label: '(sin texto)', reason: 'Figura decorativa sin texto ni tipo reconocible' });
      continue;
    }
    const hint = (
      st.match(/resicon=mxgraph\.([\w.]+)/)?.[1] ??
      st.match(/shape=mxgraph\.([\w.]+)/)?.[1] ??
      st.match(/img\/lib\/([\w/.-]+)/)?.[1] ??
      st.match(/shape=(\w+)/)?.[1] ??
      st.split(';')[0] ??
      ''
    ).slice(0, 80);
    nodes.push({
      cellId: cell.id,
      label: cell.label,
      rect,
      type: cls?.type,
      confidence: cls?.confidence ?? 'ninguna',
      by: cls?.by ?? 'por defecto',
      styleHint: hint
    });
  }

  const edges: DetectedEdge[] = [];
  for (const e of cells.filter((c) => c.edge)) {
    const childLabels = cells.filter((c) => c.parent === e.id && c.label).map((c) => c.label);
    const label = [e.label, ...childLabels].filter(Boolean).join(' ');
    if (!e.source || !e.target) {
      skipped.push({ cellId: e.id, label: label || 'flecha', reason: 'Flecha sin origen o destino conectados' });
      continue;
    }
    edges.push({ cellId: e.id, source: e.source, target: e.target, label });
  }
  return { pageName: page.name, nodes, groups, edges, skipped };
}

// ---------------------------------------------------------------- construcción

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

const ENTRY_BEHAVIORS = new Set(['load_balancer', 'api_gateway', 'service']);

export function buildFromAnalysis(
  a: DrawioAnalysis,
  opts: { overrides?: Record<string, string | 'ignore'>; name?: string } = {}
): DrawioImportResult {
  const overrides = opts.overrides ?? {};
  const assumptions: string[] = [
    'Modelo importado desde draw.io: tipos, protocolos y puertos inferidos de figuras y textos; revise la configuración.',
    'Latencias y tiempos son estimaciones conceptuales, no mediciones.'
  ];
  const warnings: string[] = [];
  const skipped = [...a.skipped];
  const used = new Set<string>();
  const uid = (base: string) => {
    let id = (slug(base) || 'componente').slice(0, 48);
    let n = 2;
    while (used.has(id)) id = `${slug(base).slice(0, 44)}-${n++}`;
    used.add(id);
    return id;
  };

  // componentes
  const comps: ComponentInstance[] = [];
  const cellToComp = new Map<string, string>();
  const rects = new Map<string, Rect>();
  const reportComps: ImportReport['components'] = [];
  for (const n of a.nodes) {
    const choice = overrides[n.cellId] ?? n.type ?? 'compute.app_server';
    if (choice === 'ignore') {
      skipped.push({ cellId: n.cellId, label: n.label, reason: 'Ignorado por el usuario' });
      continue;
    }
    if (!hasDefinition(choice)) {
      skipped.push({ cellId: n.cellId, label: n.label, reason: `Tipo desconocido ${choice}` });
      continue;
    }
    const def = getDefinition(choice);
    const name = (n.label || def.label).slice(0, 120);
    const id = uid(n.label || def.label);
    comps.push({ id, type: choice, name, props: {} });
    cellToComp.set(n.cellId, id);
    rects.set(id, n.rect);
    reportComps.push({
      id,
      cellId: n.cellId,
      name,
      type: choice,
      confidence: overrides[n.cellId] ? 'usuario' : n.type ? n.confidence : 'ninguna',
      by: overrides[n.cellId] ? 'usuario' : n.by
    });
    if (!n.type && !overrides[n.cellId]) warnings.push(`"${name}" no se reconoció; se importó como ${def.label}.`);
  }
  if (!comps.length) throw new DrawioImportError('No se reconoció ningún componente en la página seleccionada.');

  const comp = (id: string) => comps.find((c) => c.id === id)!;
  const behavior = (id: string) => getDefinition(comp(id).type).behavior;

  // conexiones
  const connections: Connection[] = [];
  const reportConns: ImportReport['connections'] = [];
  const addConn = (sourceId: string, targetId: string, protocol: Protocol, port: number, note?: string) => {
    if (connections.some((k) => k.sourceId === sourceId && k.targetId === targetId && k.protocol === protocol)) return;
    const edgy = ['client', 'transit'].includes(behavior(sourceId)) || behavior(targetId) === 'transit';
    const k: Connection = { id: `k-${connections.length + 1}`, sourceId, targetId, protocol, port, props: { latencyMs: protocol === 'DNS' ? 10 : edgy ? 20 : 2, encrypted: protocol === 'HTTPS' } };
    connections.push(k);
    reportConns.push({ id: k.id, from: comp(sourceId).name, to: comp(targetId).name, protocol, port, ...(note ? { note } : {}) });
  };
  for (const e of a.edges) {
    let s = cellToComp.get(e.source);
    let t = cellToComp.get(e.target);
    if (!s || !t || s === t) {
      skipped.push({ cellId: e.cellId, label: e.label || 'flecha', reason: 'Conecta grupos, anotaciones o figuras ignoradas' });
      continue;
    }
    const hint = protocolFromLabel(e.label);
    let options = compatibleProtocols(comp(s).type, comp(t).type);
    let note: string | undefined;
    if (!options.length) {
      const rev = compatibleProtocols(comp(t).type, comp(s).type);
      if (rev.length) {
        [s, t] = [t, s];
        options = rev;
        note = 'Sentido invertido para que sea técnicamente válido';
      }
    }
    if (!options.length) {
      skipped.push({ cellId: e.cellId, label: e.label || `${comp(s).name} → ${comp(t).name}`, reason: `Sin protocolo compatible entre ${getDefinition(comp(s).type).label} y ${getDefinition(comp(t).type).label}` });
      continue;
    }
    let protocol = options[0]!;
    if (hint.protocol && options.includes(hint.protocol)) protocol = hint.protocol;
    else if (hint.protocol) note = `${note ? note + '; ' : ''}el texto indica ${hint.protocol}, se usó ${protocol}`;
    const port = hint.port && (hint.protocol === protocol || !hint.protocol) ? hint.port : (defaultPortFor(comp(t).type, protocol) ?? 443);
    addConn(s, t, protocol, port, note);
  }

  // layout (presentación): centro de cada figura, escalado para separar ≥ 4.8 unidades
  const centers = comps.map((c) => center(rects.get(c.id)!));
  const minX = Math.min(...centers.map((p) => p.x));
  const maxX = Math.max(...centers.map((p) => p.x));
  const minY = Math.min(...centers.map((p) => p.y));
  const maxY = Math.max(...centers.map((p) => p.y));
  let dmin = Infinity;
  for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) dmin = Math.min(dmin, Math.hypot(centers[i]!.x - centers[j]!.x, centers[i]!.y - centers[j]!.y));
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = Math.max(1e-3, Math.min(extent / 30, Number.isFinite(dmin) && dmin > 0 ? dmin / 4.8 : extent / 30));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toWorld = (p: { x: number; y: number }): Vec3 => ({ x: Math.round(((p.x - cx) / scale) * 2) / 2, y: 0, z: Math.round(((p.y - cy) / scale) * 2) / 2 });
  const positions: Record<string, Vec3> = {};
  comps.forEach((c, i) => (positions[c.id] = toWorld(centers[i]!)));

  // grupos
  const groups: Group[] = [];
  const groupRects = new Map<string, Rect>();
  for (const g of a.groups) {
    const members = comps.filter((c) => inside(rects.get(c.id)!, g.rect) || (() => { const p = center(rects.get(c.id)!); return p.x >= g.rect.x && p.x <= g.rect.x + g.rect.w && p.y >= g.rect.y && p.y <= g.rect.y + g.rect.h; })()).map((c) => c.id);
    if (!members.length) continue;
    const id = uid(`g-${g.label || g.kind}`);
    const cidr = g.label.match(/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/)?.[0];
    groups.push({ id, kind: g.kind, name: (g.label || g.kind).slice(0, 120), memberIds: members, props: { ...(cidr ? { cidr } : {}), ...(/p[uú]blic/i.test(g.label) ? { public: true } : /priva/i.test(g.label) ? { public: false } : {}) } });
    groupRects.set(id, g.rect);
  }
  for (const g of groups) {
    const r = groupRects.get(g.id)!;
    const parents = groups.filter((o) => o.id !== g.id && inside(r, groupRects.get(o.id)!)).sort((x, y) => groupRects.get(x.id)!.w * groupRects.get(x.id)!.h - groupRects.get(y.id)!.w * groupRects.get(y.id)!.h);
    if (parents[0]) g.parentId = parents[0].id;
  }

  // ---- completado mínimo para simular (cada paso queda como supuesto) ----
  const outgoing = (id: string) => connections.filter((k) => k.sourceId === id && k.protocol !== 'DNS');
  const findEntry = (from: string): string | undefined => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur !== from && ENTRY_BEHAVIORS.has(behavior(cur))) return cur;
      for (const k of outgoing(cur)) if (!seen.has(k.targetId)) (seen.add(k.targetId), queue.push(k.targetId));
    }
    return undefined;
  };
  let clients = comps.filter((c) => behavior(c.id) === 'client');
  if (!clients.length) {
    const incoming = (id: string) => connections.some((k) => k.targetId === id);
    const entry =
      comps.find((c) => ['load_balancer', 'api_gateway'].includes(behavior(c.id)) && !incoming(c.id)) ??
      comps.find((c) => behavior(c.id) === 'service' && !incoming(c.id)) ??
      comps.find((c) => ENTRY_BEHAVIORS.has(behavior(c.id)));
    if (entry) {
      const id = uid('usuario');
      comps.push({ id, type: 'client.browser', name: 'Usuario (supuesto)', props: {} });
      const p = positions[entry.id]!;
      positions[id] = { x: p.x - 7, y: 0, z: p.z };
      addConn(id, entry.id, 'HTTPS', defaultPortFor(entry.type, 'HTTPS') ?? 443);
      assumptions.push(`El diagrama no tenía usuarios: se agregó "Usuario (supuesto)" que llama a ${entry.name}.`);
      clients = [comps.at(-1)!];
    } else warnings.push('No hay un punto de entrada HTTP (balanceador, gateway o servicio): no se podrá simular una solicitud.');
  }
  let dnsId = comps.find((c) => behavior(c.id) === 'dns')?.id;
  const records: { host: string; targetId: string }[] = [];
  clients.forEach((c, i) => {
    const entry = findEntry(c.id);
    if (!entry) {
      warnings.push(`${c.name} no llega a ningún balanceador, gateway o servicio siguiendo las flechas.`);
      return;
    }
    const host = `app${clients.length > 1 ? i + 1 : ''}.importado.example`;
    c.props = { ...c.props, targetHost: host };
    if (!dnsId) {
      dnsId = uid('dns');
      comps.push({ id: dnsId, type: 'network.dns', name: 'DNS (supuesto)', props: {} });
      const p = positions[c.id]!;
      positions[dnsId] = { x: p.x + 2, y: 0, z: p.z - 6 };
      assumptions.push('Se agregó un DNS (supuesto) para resolver el nombre del punto de entrada.');
    }
    if (!connections.some((k) => k.sourceId === c.id && k.targetId === dnsId)) addConn(c.id, dnsId, 'DNS', 53);
    records.push({ host, targetId: entry });
  });
  if (dnsId) {
    const d = comp(dnsId);
    const prev = (d.props['records'] as { host: string; targetId: string }[] | undefined) ?? [];
    d.props = { ...d.props, records: [...prev, ...records] };
  }
  for (const c of comps) {
    const b = behavior(c.id);
    const inbound = connections.filter((k) => k.targetId === c.id);
    if (b === 'datastore' && getDefinition(c.type).defaultProps['securityGroup'] && (getDefinition(c.type).defaultProps['securityGroup'] as { enabled: boolean }).enabled) {
      c.props = { ...c.props, securityGroup: { enabled: true, inbound: inbound.map((k, i) => ({ id: `sg-${i + 1}`, protocol: k.protocol, port: k.port, sourceId: k.sourceId })) } };
      if (inbound.length) assumptions.push(`Security Group de ${c.name}: se permiten sólo los orígenes dibujados.`);
    }
    if (b === 'datastore' && getDefinition(c.type).defaultProps['requiresIam']) {
      const action = String(getDefinition(c.type).defaultProps['requiredAction']);
      for (const k of inbound) {
        const caller = comp(k.sourceId);
        if (behavior(caller.id) === 'service') caller.props = { ...caller.props, iamPermissions: [...new Set([...((caller.props['iamPermissions'] as string[]) ?? []), action])] };
      }
      if (inbound.length) assumptions.push(`Los servicios que acceden a ${c.name} tienen el permiso IAM ${action}.`);
    }
    if (b === 'firewall') {
      const rules = [...new Map(inbound.map((k) => [`${k.protocol}:${k.port}`, k])).values()].map((k, i) => ({ id: `allow-${k.protocol.toLowerCase()}-${k.port}`, priority: 100 + i, action: 'allow', protocol: k.protocol, port: k.port, source: '0.0.0.0/0' }));
      if (rules.length) {
        c.props = { ...c.props, rules };
        assumptions.push(`${c.name}: se permiten los protocolos/puertos dibujados hacia él.`);
      }
    }
  }

  const name = (opts.name || a.pageName || 'Diagrama importado').slice(0, 200);
  const model: ArchitectureModel = {
    schemaVersion: SCHEMA_VERSION,
    id: `imported-${slug(name) || 'diagrama'}`.slice(0, 64),
    name,
    description: `Importado desde draw.io (página «${a.pageName}»).`,
    revision: 0,
    status: 'draft',
    components: comps,
    connections,
    groups,
    layout: { positions },
    assumptions
  };
  const parsed = parseModel(model);
  if (!parsed.ok) throw new DrawioImportError(`El modelo resultante no es válido: ${parsed.errors[0]}`);
  const report: ImportReport = {
    pageName: a.pageName,
    components: reportComps,
    connections: reportConns,
    groups: groups.map((g) => ({ id: g.id, name: g.name, kind: g.kind, members: g.memberIds.length })),
    skipped,
    assumptions,
    warnings
  };
  return { model: parsed.value, scenarios: scenariosFor(parsed.value), report };
}

/** Escenarios generados según lo que contiene el diagrama. */
export function scenariosFor(model: ArchitectureModel): Scenario[] {
  const b = (c: ComponentInstance) => getDefinition(c.type).behavior;
  const client = model.components.find((c) => b(c) === 'client' && typeof c.props['targetHost'] === 'string');
  if (!client) return [];
  const req = { method: 'GET' as const, path: '/', payload: { requestId: 'REQ-0001', source: 'sintético' }, auth: 'valid' as const };
  const base = { entryComponentId: client.id, request: req, intervalMs: 0, requestCount: 1, faults: [] };
  const out: Scenario[] = [{ ...base, id: 'imp-A-main', name: 'A · Flujo principal', description: 'Una solicitud recorre la arquitectura importada tal como fue dibujada.', kind: 'success' }];
  const letters = 'BCDEFG';
  const push = (s: Omit<Scenario, 'id' | 'name'> & { title: string; key: string }) => {
    const l = letters[out.length - 1] ?? 'X';
    const { title, key, ...rest } = s;
    out.push({ ...rest, id: `imp-${l}-${key}`, name: `${l} · ${title}` });
  };
  const store = model.components.find((c) => b(c) === 'datastore');
  if (store) push({ ...base, key: 'store-down', title: `Caída de ${store.name}`, description: `${store.name} deja de responder: timeouts, reintentos y propagación hacia el usuario.`, kind: 'failure', requestCount: 2, intervalMs: 20000, faults: [{ kind: 'COMPONENT_DOWN', componentId: store.id }] });
  const lb = model.components.find((c) => b(c) === 'load_balancer' && model.connections.filter((k) => k.sourceId === c.id).length >= 2);
  if (lb) {
    const target = model.connections.find((k) => k.sourceId === lb.id)!.targetId;
    push({ ...base, key: 'instance-down', title: `Caída de ${model.components.find((c) => c.id === target)?.name}`, description: 'Una instancia detrás del balanceador cae; los health checks deberían excluirla.', kind: 'resilience', requestCount: 2, intervalMs: 1000, faults: [{ kind: 'COMPONENT_DOWN', componentId: target }] });
  }
  const fw = model.components.find((c) => b(c) === 'firewall');
  if (fw) {
    const rules = (fw.props['rules'] as unknown[] | undefined) ?? (getDefinition(fw.type).defaultProps['rules'] as unknown[]);
    push({
      ...base,
      key: 'fw-block',
      title: `Bloqueo en ${fw.name}`,
      description: 'Se activa una regla de mayor prioridad que deniega HTTPS/443.',
      kind: 'block',
      setup: [{ op: 'update_component', componentId: fw.id, patch: { props: { rules: [{ id: 'deny-https-test', priority: 10, action: 'deny', protocol: 'HTTPS', port: 443, source: '0.0.0.0/0', description: 'Bloqueo de prueba' }, ...rules] } } }]
    });
  }
  const dns = model.components.find((c) => b(c) === 'dns');
  if (dns) push({ ...base, key: 'dns-down', title: 'Falla de DNS', description: 'El DNS no responde: el cliente nunca abre la conexión.', kind: 'failure', faults: [{ kind: 'COMPONENT_DOWN', componentId: dns.id }] });
  return out;
}

/** Conveniencia: lee, analiza la primera página (o la indicada) y construye. */
export async function importDrawio(input: string, opts: { inflateRaw: InflateRaw; pageId?: string; overrides?: Record<string, string>; name?: string }): Promise<DrawioImportResult & { pages: DrawioPage[]; analysis: DrawioAnalysis }> {
  const pages = await readDrawio(input, opts);
  const page = pages.find((p) => p.id === opts.pageId) ?? pages[0]!;
  const analysis = analyzeDrawioPage(page);
  return { ...buildFromAnalysis(analysis, { ...(opts.overrides ? { overrides: opts.overrides } : {}), ...(opts.name ? { name: opts.name } : {}) }), pages, analysis };
}
