/** Utilidades de red puras: CIDR, coincidencia de reglas y búsqueda de rutas. */
import type { ArchitectureModel, Connection, FirewallRule, Protocol, SecurityGroupRule } from '@asa/core-model';

const TCP_BASED: ReadonlySet<Protocol> = new Set(['TCP', 'HTTP', 'HTTPS', 'JDBC', 'SSH', 'SFTP']);

function ipToInt(ip: string): number | undefined {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr ?? '32');
  const b = ipToInt(base ?? '');
  const i = ipToInt(ip);
  if (b === undefined || i === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (b & mask) === (i & mask);
}

/** Una regla 'TCP' cubre cualquier protocolo de aplicación sobre TCP (los SG/firewalls L4 no ven L7). */
export function protocolMatches(rule: Protocol | 'ANY', actual: Protocol): boolean {
  if (rule === 'ANY' || rule === actual) return true;
  return rule === 'TCP' && TCP_BASED.has(actual);
}

export function evaluateFirewall(
  rules: FirewallRule[],
  defaultAction: 'allow' | 'deny',
  traffic: { protocol: Protocol; port: number; sourceIp: string }
): { action: 'allow' | 'deny'; rule?: FirewallRule } {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const r of sorted) {
    if (protocolMatches(r.protocol, traffic.protocol) && (r.port === 'ANY' || r.port === traffic.port) && cidrContains(r.source, traffic.sourceIp)) {
      return { action: r.action, rule: r };
    }
  }
  return { action: defaultAction };
}

export function matchSecurityGroup(rules: SecurityGroupRule[], traffic: { protocol: Protocol; port: number; sourceId: string }): SecurityGroupRule | undefined {
  return rules.find(
    (r) => protocolMatches(r.protocol, traffic.protocol) && (r.port === 'ANY' || r.port === traffic.port) && (r.sourceId === 'any' || r.sourceId === traffic.sourceId)
  );
}

/**
 * Ruta más corta (BFS, desempate determinista por ID de conexión) entre dos componentes,
 * usando solo conexiones de transporte de solicitudes (excluye DNS).
 */
export function findPath(model: ArchitectureModel, fromId: string, toId: string): Connection[] | undefined {
  const adj = new Map<string, Connection[]>();
  for (const k of [...model.connections].sort((a, b) => a.id.localeCompare(b.id))) {
    if (k.protocol === 'DNS') continue;
    const list = adj.get(k.sourceId) ?? [];
    list.push(k);
    adj.set(k.sourceId, list);
  }
  const prev = new Map<string, Connection>();
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toId) break;
    for (const k of adj.get(cur) ?? []) {
      if (seen.has(k.targetId)) continue;
      seen.add(k.targetId);
      prev.set(k.targetId, k);
      queue.push(k.targetId);
    }
  }
  if (!seen.has(toId) || fromId === toId) return undefined;
  const path: Connection[] = [];
  let node = toId;
  while (node !== fromId) {
    const k = prev.get(node)!;
    path.unshift(k);
    node = k.sourceId;
  }
  return path;
}
