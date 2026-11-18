/**
 * Validación estática del modelo (motor de reglas declarativas sobre la topología y configuración).
 * No ejecuta simulación ni usa posiciones 3D.
 */
import { compatibleProtocols, getDefinition, hasDefinition } from './catalog';
import type { ValidationFinding } from './contracts';
import { clientProps, datastoreProps, dnsProps, firewallProps, serviceProps } from './props';
import type { ArchitectureModel } from './types';

type Rule = (m: ArchitectureModel) => ValidationFinding[];

const rules: Rule[] = [
  // Tipos conocidos
  (m) =>
    m.components
      .filter((c) => !hasDefinition(c.type))
      .map((c) => ({ id: `unknown-type:${c.id}`, level: 'error', message: `Tipo desconocido "${c.type}"`, componentIds: [c.id] })),

  // Conexiones con extremos válidos y protocolo compatible
  (m) => {
    const out: ValidationFinding[] = [];
    const byId = new Map(m.components.map((c) => [c.id, c]));
    for (const k of m.connections) {
      const s = byId.get(k.sourceId);
      const t = byId.get(k.targetId);
      if (!s || !t) {
        out.push({ id: `dangling:${k.id}`, level: 'error', message: 'Conexión con extremo inexistente', componentIds: [], connectionId: k.id });
        continue;
      }
      if (!hasDefinition(s.type) || !hasDefinition(t.type)) continue;
      if (!compatibleProtocols(s.type, t.type).includes(k.protocol)) {
        out.push({
          id: `protocol:${k.id}`,
          level: 'error',
          message: `${t.name} no acepta ${k.protocol} desde ${s.name}`,
          componentIds: [s.id, t.id],
          connectionId: k.id
        });
      }
      const listens = getDefinition(t.type).inbound.filter((p) => p.protocol === k.protocol).map((p) => p.port);
      if (listens.length && !listens.includes(k.port)) {
        out.push({
          id: `port:${k.id}`,
          level: 'warning',
          message: `${t.name} escucha ${k.protocol} en ${listens.join(', ')} pero la conexión usa ${k.port}`,
          componentIds: [t.id],
          connectionId: k.id
        });
      }
      if (!k.props.encrypted && (k.protocol === 'HTTP' || k.protocol === 'JDBC')) {
        out.push({
          id: `plaintext:${k.id}`,
          level: 'info',
          message: `Tramo ${s.name} → ${t.name} (${k.protocol}) sin cifrado declarado`,
          componentIds: [s.id, t.id],
          connectionId: k.id
        });
      }
    }
    return out;
  },

  // Componentes aislados
  (m) =>
    m.components
      .filter((c) => !m.connections.some((k) => k.sourceId === c.id || k.targetId === c.id))
      .map((c) => ({ id: `isolated:${c.id}`, level: 'warning', message: `${c.name} no tiene conexiones`, componentIds: [c.id] })),

  // DNS apunta a componentes existentes
  (m) => {
    const out: ValidationFinding[] = [];
    for (const c of m.components.filter((x) => hasDefinition(x.type) && getDefinition(x.type).behavior === 'dns')) {
      for (const r of dnsProps(c).records) {
        if (!m.components.some((x) => x.id === r.targetId))
          out.push({ id: `dns-target:${c.id}:${r.host}`, level: 'error', message: `Registro ${r.host} apunta a un componente inexistente`, componentIds: [c.id] });
      }
    }
    for (const c of m.components.filter((x) => hasDefinition(x.type) && getDefinition(x.type).behavior === 'client')) {
      const host = clientProps(c).targetHost;
      const resolvable = m.components.some(
        (d) => hasDefinition(d.type) && getDefinition(d.type).behavior === 'dns' && dnsProps(d).records.some((r) => r.host === host)
      );
      if (!resolvable) out.push({ id: `unresolvable:${c.id}`, level: 'warning', message: `Ningún DNS resuelve ${host}`, componentIds: [c.id] });
    }
    return out;
  },

  // Firewall: reglas permisivas
  (m) =>
    m.components
      .filter((c) => hasDefinition(c.type) && getDefinition(c.type).behavior === 'firewall')
      .flatMap((c) =>
        firewallProps(c)
          .rules.filter((r) => r.action === 'allow' && r.protocol === 'ANY' && r.port === 'ANY')
          .map((r) => ({ id: `fw-any:${c.id}:${r.id}`, level: 'warning' as const, message: `Regla ${r.id} permite cualquier protocolo y puerto`, componentIds: [c.id] }))
      ),

  // Datastores: punto único de falla / SG abierto
  (m) =>
    m.components
      .filter((c) => hasDefinition(c.type) && getDefinition(c.type).behavior === 'datastore')
      .flatMap((c) => {
        const p = datastoreProps(c);
        const f: ValidationFinding[] = [];
        if (!p.multiAz) f.push({ id: `spof:${c.id}`, level: 'warning', message: `${c.name} sin Multi-AZ: punto único de falla`, componentIds: [c.id] });
        if (p.securityGroup.enabled && p.securityGroup.inbound.some((r) => r.sourceId === 'any'))
          f.push({ id: `sg-open:${c.id}`, level: 'warning', message: `${c.name} acepta tráfico desde cualquier origen`, componentIds: [c.id] });
        return f;
      }),

  // Servicios: reintentos sin circuit breaker
  (m) =>
    m.components
      .filter((c) => hasDefinition(c.type) && getDefinition(c.type).behavior === 'service')
      .flatMap((c) => {
        const p = serviceProps(c);
        return p.retries > 0 && !p.circuitBreaker.enabled
          ? [{ id: `no-cb:${c.id}`, level: 'info' as const, message: `${c.name} reintenta sin circuit breaker`, componentIds: [c.id] }]
          : [];
      })
];

export function validateModel(model: ArchitectureModel): ValidationFinding[] {
  return rules.flatMap((r) => r(model));
}
