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
import { classify, groupKindOf, IGNORE_TYPE, isNonTrafficRelation, protocolFromLabel } from './mapping';
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
  /** Primera línea del texto (nombre corto). */
  title: string;
  rect: Rect;
  /** Tipo sugerido (undefined = no reconocido). */
  type: string | undefined;
  confidence: 'alta' | 'media' | 'baja' | 'ninguna';
  by: 'estilo' | 'texto' | 'grupo' | 'por defecto';
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
  /** Unida a través de un conector fuera de página (Ⓐ, Ⓑ…). */
  via?: string;
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
  title: string;
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
        const rawLabel = c.attrs['label'] ?? cell.attrs['value'] ?? '';
        const entry: Cell = {
          id,
          label: stripHtml(rawLabel),
          title: rawLabel.split(/<br\s*\/?>|\n|<\/div>|<div[^>]*>|<\/p>/i).map(stripHtml).find(Boolean) ?? '',
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
  const connectors = new Map<string, string[]>(); // etiqueta → cellIds
  for (const { cell, rect } of candidates) {
    const st = cell.style.toLowerCase();
    // conectores fuera de página: círculos pequeños con 1-2 caracteres (Ⓐ, B, 1…)
    if (/^[\p{L}\p{N}]{1,2}$/u.test(cell.label) && (/ellipse|shape=(off|on)pageconnector|doubleellipse/.test(st) || (rect.w <= 60 && rect.h <= 60))) {
      connectors.set(cell.label, [...(connectors.get(cell.label) ?? []), cell.id]);
      continue;
    }
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
    if (cls?.type === IGNORE_TYPE) {
      skipped.push({ cellId: cell.id, label: cell.label || '(sin texto)', reason: 'Configuración de red (tabla de rutas, ACL, SG): se refleja en la conectividad, no como componente' });
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
      title: cell.title || cell.label,
      rect,
      type: cls?.type,
      confidence: cls?.confidence ?? 'ninguna',
      by: cls?.by ?? 'por defecto',
      styleHint: hint
    });
  }

  // contexto de grupo: figuras sin tipo claro dentro de "Sistemas externos / SaaS"
  for (const n of nodes) {
    if (n.by === 'estilo' || n.confidence === 'alta') continue;
    const g = groups.find((x) => inside(n.rect, x.rect) && /extern|saas|tercer|third.?part/i.test(x.label));
    if (g && n.type !== 'integration.saas_api') Object.assign(n, { type: 'integration.saas_api', confidence: 'media', by: 'grupo' });
  }

  const rawEdges: DetectedEdge[] = [];
  for (const e of cells.filter((c) => c.edge)) {
    const childLabels = cells.filter((c) => c.parent === e.id && c.label).map((c) => c.label);
    const label = [e.label, ...childLabels].filter(Boolean).join(' ');
    if (!e.source || !e.target) {
      skipped.push({ cellId: e.id, label: label || 'flecha', reason: 'Flecha sin origen o destino conectados' });
      continue;
    }
    rawEdges.push({ cellId: e.id, source: e.source, target: e.target, label });
  }

  // une flechas a través de conectores con la misma etiqueta: (X → Ⓑ) + (Ⓑ → Y) = X → Y
  const connectorOf = new Map<string, string>();
  for (const [lbl, ids] of connectors) for (const id of ids) connectorOf.set(id, lbl);
  const edges: DetectedEdge[] = rawEdges.filter((e) => !connectorOf.has(e.source) && !connectorOf.has(e.target));
  for (const [lbl] of connectors) {
    const ins = rawEdges.filter((e) => connectorOf.get(e.target) === lbl && !connectorOf.has(e.source));
    const outs = rawEdges.filter((e) => connectorOf.get(e.source) === lbl && !connectorOf.has(e.target));
    if (!ins.length || !outs.length) {
      skipped.push({ cellId: `conector-${lbl}`, label: `Conector «${lbl}»`, reason: ins.length ? 'Conector sin flecha de salida' : 'Conector sin flecha de entrada: no se puede unir' });
      continue;
    }
    for (const i of ins) for (const o of outs) edges.push({ cellId: `${i.cellId}+${o.cellId}`, source: i.source, target: o.target, label: [i.label, o.label].filter(Boolean).join(' · '), via: lbl });
  }

  // notas y tablas: figuras sin ninguna flecha, reconocidas sólo por texto y con texto largo/explicativo
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  for (const n of [...nodes]) {
    if (linked.has(n.cellId) || n.by === 'estilo') continue;
    if (n.label.length > 45 || /ingress|egress|nota\b|note\b|leyenda|legend|resumen|summary|⚠|reglas|rules/i.test(n.label)) {
      nodes.splice(nodes.indexOf(n), 1);
      skipped.push({ cellId: n.cellId, label: n.label.slice(0, 80), reason: 'Nota o tabla explicativa sin conexiones' });
    }
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
  const fullLabel = new Map<string, string>();
  const titleCount = new Map<string, number>();
  for (const n of a.nodes) titleCount.set(n.title, (titleCount.get(n.title) ?? 0) + 1);
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
    const generic = !n.title || n.title.length < 4 || (titleCount.get(n.title) ?? 0) > 1 || (!/\s/.test(n.title) && n.label.length <= 40);
    const short = generic ? n.label : n.title;
    const name = (short || def.label).slice(0, 80);
    const id = uid(short || def.label);
    comps.push({ id, type: choice, name, props: {} });
    cellToComp.set(n.cellId, id);
    rects.set(id, n.rect);
    fullLabel.set(id, n.label || name);
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
  const groupRectByCell = new Map(a.groups.map((g) => [g.cellId, g]));
  const tokens = (x: string) => new Set(x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length >= 3 || /\d/.test(t)));
  const STOP = new Set(['via', 'para', 'solo', 'desde', 'hacia', 'the', 'and', 'con', 'red', 'interna', 'https', 'http', 'tcp', 'api', 'rest']);
  /** Representante de un grupo como extremo de una flecha. */
  const resolveGroup = (gCell: string, role: 'source' | 'target', label: string): string | undefined => {
    const g = groupRectByCell.get(gCell);
    if (!g) return undefined;
    const members = comps.filter((c) => inside(rects.get(c.id)!, g.rect));
    if (!members.length) return undefined;
    const lt = [...tokens(label)].filter((t) => !STOP.has(t) && !/^\d+$/.test(t));
    const named = members.find((m) => lt.some((t) => tokens(fullLabel.get(m.id) ?? m.name).has(t)));
    if (named) return named.id;
    const by = (b: string[]) => members.find((m) => b.includes(behavior(m.id)));
    if (role === 'source') {
      const client = by(['client']);
      if (client) {
        // el tráfico sale del grupo por el tránsito al que se conecta el cliente (p. ej. VPN)
        const exit = a.edges
          .map((e) => [cellToComp.get(e.source), cellToComp.get(e.target)] as const)
          .find(([src, dst]) => dst && members.some((m) => m.id === dst) && ['transit', 'firewall'].includes(behavior(dst)) && (src === client.id || (src && behavior(src) === 'dns')));
        return exit?.[1] ?? client.id;
      }
      return (by(['service']) ?? members[0])!.id;
    }
    const pick = by(['load_balancer', 'api_gateway']) ?? by(['service']) ?? members[0]!;
    // si al elegido ya llega un balanceador/gateway externo al grupo, se entra por él
    const viaLb = a.edges
      .map((e) => [cellToComp.get(e.source), cellToComp.get(e.target)] as const)
      .find(([src, dst]) => dst === pick.id && src && ['load_balancer', 'api_gateway'].includes(behavior(src)) && !members.some((m) => m.id === src));
    return viaLb?.[0] ?? pick.id;
  };
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const stepOf = (l: string) => {
    const c = [...l].find((ch) => CIRCLED.includes(ch));
    if (c) return CIRCLED.indexOf(c) + 1;
    const m = l.match(/^\s*(\d{1,2})[.)]\s/);
    return m ? Number(m[1]) : 999;
  };
  const orderedEdges = [...a.edges].sort((x, y) => stepOf(x.label) - stepOf(y.label));
  for (const e of orderedEdges) {
    if (isNonTrafficRelation(e.label)) {
      skipped.push({ cellId: e.cellId, label: e.label, reason: 'Relación de configuración o ciclo de vida (no es tráfico en tiempo de ejecución)' });
      continue;
    }
    let s = cellToComp.get(e.source) ?? resolveGroup(e.source, 'source', e.label);
    let t = cellToComp.get(e.target) ?? resolveGroup(e.target, 'target', e.label);
    const fromGroup = !cellToComp.has(e.source) || !cellToComp.has(e.target);
    if (!s || !t || s === t) {
      skipped.push({ cellId: e.cellId, label: e.label || 'flecha', reason: 'Conecta anotaciones, grupos vacíos o figuras ignoradas' });
      continue;
    }
    const hint = protocolFromLabel(e.label);
    const notes: string[] = [];
    if (e.via) notes.push(`unida por el conector «${e.via}»`);
    if (fromGroup) notes.push('flecha entre grupos: se usó un componente representativo');
    // una flecha no-DNS que sale de un DNS describe el siguiente paso del cliente que lo consulta
    if (behavior(s) === 'dns' && hint.protocol !== 'DNS') {
      const client = a.edges.map((x) => [cellToComp.get(x.source), cellToComp.get(x.target)] as const).find(([src, dst]) => dst === s && src && behavior(src) === 'client')?.[0];
      if (client) {
        s = client;
        notes.push('el paso posterior al DNS se asignó al cliente que lo consulta');
      }
    }
    const PREF: Protocol[] = ['HTTPS', 'HTTP', 'JDBC', 'TCP', 'DNS', 'SFTP', 'SSH'];
    const ranked = (x: Protocol[]) => [...x].sort((p1, p2) => PREF.indexOf(p1) - PREF.indexOf(p2));
    let options = ranked(compatibleProtocols(comp(s).type, comp(t).type));
    if (!options.length) {
      const rev = ranked(compatibleProtocols(comp(t).type, comp(s).type));
      if (rev.length) {
        [s, t] = [t, s];
        options = rev;
        notes.push('sentido invertido para que sea técnicamente válido');
      }
    }
    if (!options.length) {
      skipped.push({ cellId: e.cellId, label: e.label || `${comp(s).name} → ${comp(t).name}`, reason: `Sin protocolo compatible entre ${getDefinition(comp(s).type).label} y ${getDefinition(comp(t).type).label}` });
      continue;
    }
    let protocol = options[0]!;
    if (hint.protocol && options.includes(hint.protocol)) protocol = hint.protocol;
    else if (hint.protocol === 'TCP' && options.some((p) => p === 'HTTP' || p === 'HTTPS')) protocol = options.includes('HTTP') ? 'HTTP' : 'HTTPS';
    else if (hint.protocol) notes.push(`el texto indica ${hint.protocol}, se usó ${protocol}`);
    const l4Compatible = hint.protocol === protocol || !hint.protocol || (hint.protocol === 'TCP' && protocol !== 'DNS');
    const port = hint.port && l4Compatible ? hint.port : (defaultPortFor(comp(t).type, protocol) ?? 443);
    addConn(s, t, protocol, port, notes.length ? notes.join('; ') : undefined);
  }

  // endpoints privados sin destino: se enlazan al servicio que nombran (p. ej. "Endpoint Secrets" → Secrets Manager)
  for (const ep of comps.filter((c) => c.type === 'network.vpc_endpoint' && !connections.some((k) => k.sourceId === c.id))) {
    const words = [...tokens(fullLabel.get(ep.id) ?? ep.name)].filter((t) => !['endpoint', 'privatelink', 'private', 'link', 'gateway', 'interface', 'vpc', 'mgr'].includes(t));
    const lead = (x: string) => new Set([...tokens(x)].slice(0, 3));
    const viaGroup = a.groups.find((g) => words.some((w) => lead(g.label).has(w)));
    const groupMembers = viaGroup ? comps.filter((c) => c.id !== ep.id && c.type !== 'network.vpc_endpoint' && inside(rects.get(c.id)!, viaGroup.rect)) : [];
    const targets = comps.filter((c) => c.id !== ep.id && c.type !== 'network.vpc_endpoint' && words.some((w) => lead(c.name).has(w)));
    const dests = groupMembers.length ? groupMembers : targets;
    for (const d of dests) {
      const p = compatibleProtocols(ep.type, d.type)[0];
      if (p) addConn(ep.id, d.id, p, defaultPortFor(d.type, p) ?? 443, 'endpoint enlazado al servicio que expone (supuesto)');
    }
    if (dests.length) assumptions.push(`${ep.name} se enlazó a ${dests.map((d) => d.name).join(', ')} por coincidencia de nombre.`);
  }

  // layout (presentación): centro de cada figura, escalado para separar ≥ 4.8 unidades
  const centers = comps.map((c) => center(rects.get(c.id)!));
  const minX = Math.min(...centers.map((p) => p.x));
  const maxX = Math.max(...centers.map((p) => p.x));
  const minY = Math.min(...centers.map((p) => p.y));
  const maxY = Math.max(...centers.map((p) => p.y));
  // escala robusta: mediana de la distancia al vecino más cercano (un grupo compacto no infla todo)
  const nn = centers.map((p, i) => Math.min(...centers.map((q, j) => (i === j ? Infinity : Math.hypot(p.x - q.x, p.y - q.y)))));
  const sorted = nn.filter(Number.isFinite).sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 1;
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = Math.max(1e-3, extent / 58, median / 6.5);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const positions: Record<string, Vec3> = {};
  const pts = centers.map((p) => ({ x: (p.x - cx) / scale, z: (p.y - cy) / scale }));
  // relajación determinista: separa pares a menos de 4.4 unidades (mantiene la disposición general)
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a1 = pts[i]!;
        const b1 = pts[j]!;
        let dx = b1.x - a1.x;
        let dz = b1.z - a1.z;
        let d = Math.hypot(dx, dz);
        if (d >= 4.4) continue;
        if (d < 1e-6) {
          dx = 1;
          dz = 0;
          d = 1;
        }
        const push = (4.4 - d) / 2;
        a1.x -= (dx / d) * push;
        a1.z -= (dz / d) * push;
        b1.x += (dx / d) * push;
        b1.z += (dz / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  comps.forEach((c, i) => (positions[c.id] = { x: Math.round(pts[i]!.x * 2) / 2, y: 0, z: Math.round(pts[i]!.z * 2) / 2 }));

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
    const fromDns = dnsId ? (fullLabel.get(dnsId) ?? comp(dnsId).name).match(/\b(?:[a-z0-9-]+\.)+(?:corp|com|cl|net|org|io|local|internal|cloud|app|dev)\b/i)?.[0] : undefined;
    const host = fromDns && clients.length === 1 ? fromDns.toLowerCase() : `app${clients.length > 1 ? i + 1 : ''}.importado.example`;
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
  const letters = 'BCDEFGHI';
  const push = (s: Omit<Scenario, 'id' | 'name'> & { title: string; key: string }) => {
    const l = letters[out.length - 1] ?? 'X';
    const { title, key, ...rest } = s;
    out.push({ ...rest, id: `imp-${l}-${key}`, name: `${l} · ${title}` });
  };
  const called = (c: ComponentInstance) => model.connections.some((k) => k.targetId === c.id);
  const store = model.components.find((c) => c.type.startsWith('data.') && called(c)) ?? model.components.find((c) => b(c) === 'datastore' && called(c));
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
  const vpn = model.components.find((c) => c.type === 'network.vpn' && called(c));
  if (vpn) push({ ...base, key: 'vpn-down', title: `Caída de ${vpn.name}`, description: 'El enlace privado entre la red corporativa y la nube deja de responder.', kind: 'failure', faults: [{ kind: 'COMPONENT_DOWN', componentId: vpn.id }] });
  const ext = model.components.find((c) => c.type === 'integration.saas_api' && called(c));
  if (ext) push({ ...base, key: 'saas-down', title: `Caída de ${ext.name}`, description: 'Un sistema externo deja de responder: ¿la aplicación lo tolera o el error se propaga al usuario?', kind: 'failure', requestCount: 2, intervalMs: 20000, faults: [{ kind: 'COMPONENT_DOWN', componentId: ext.id }] });
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
