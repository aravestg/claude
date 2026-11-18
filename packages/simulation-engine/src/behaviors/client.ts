/**
 * Flujo de borde: el cliente resuelve DNS, abre TCP(+TLS) atravesando tránsito y firewalls
 * (evaluación stateful del SYN), envía la solicitud y recibe la respuesta por la ruta inversa.
 */
import type { FailureCategory } from '@asa/core-model';
import { clientProps, dnsProps, firewallProps } from '@asa/core-model';
import { evaluateFirewall, findPath } from '../net';
import type { Run, Trace } from '../run';
import { handleRequest, statusText } from './handlers';
import type { Outcome, SimRequest } from './types';
import { isOk } from './types';

const DNS_TIMEOUT_MS = 5000;

export interface ClientResult {
  outcome: Outcome;
  path: string[];
}

export function runClientRequest(run: Run, clientId: string, req: SimRequest, trace: Trace): ClientResult {
  const cp = clientProps(run.comp(clientId));
  const path: string[] = [clientId];
  run.emit(trace, {
    type: 'REQUEST_STARTED',
    status: 'info',
    sourceId: clientId,
    data: { method: req.method, path: req.path, host: cp.targetHost, payload: req.payload },
    message: `${run.name(clientId)} inicia ${req.method} https://${cp.targetHost}${req.path}`,
    basic: 'El usuario hace una petición a la aplicación.',
    advanced: `Payload sintético. Timeout del cliente ${cp.timeoutMs} ms. Origen ${cp.sourceIp}.`
  });

  // ---- DNS ----
  const dnsConn = run.outgoing(clientId).find((k) => k.protocol === 'DNS');
  if (!dnsConn) return fail(run, trace, clientId, path, 'dns', 'El cliente no tiene acceso a un DNS', 'DNS_RESOLUTION_FAILED');
  path.push(dnsConn.targetId);
  run.emit(trace, {
    type: 'DNS_RESOLUTION_STARTED',
    status: 'active',
    sourceId: clientId,
    targetId: dnsConn.targetId,
    connectionId: dnsConn.id,
    duration: run.latency(dnsConn),
    data: { protocol: 'DNS', port: dnsConn.port, query: `${cp.targetHost} A?` },
    message: `Consulta DNS: ${cp.targetHost}`,
    basic: 'El navegador pregunta en qué dirección está la aplicación.',
    advanced: `Consulta A/ALIAS por UDP/${dnsConn.port}.`
  });
  const dnsStart = run.clock - run.latency(dnsConn);
  if (!run.isAvailable(dnsConn.targetId)) {
    run.emit(trace, {
      type: 'SERVICE_UNAVAILABLE',
      status: 'error',
      sourceId: dnsConn.targetId,
      failure: 'dns',
      message: `${run.name(dnsConn.targetId)} no responde`,
      basic: 'El servicio de nombres no contesta.',
      advanced: 'Sin resolución no hay IP de destino: la aplicación nunca recibe tráfico, aunque esté sana.'
    });
    run.clock = dnsStart + DNS_TIMEOUT_MS;
    return fail(run, trace, clientId, path, 'dns', `No se pudo resolver ${cp.targetHost} (timeout ${DNS_TIMEOUT_MS} ms)`, 'DNS_RESOLUTION_FAILED');
  }
  const dp = dnsProps(run.comp(dnsConn.targetId));
  const record = dp.records.find((r) => r.host === cp.targetHost);
  run.clock += dp.resolveMs;
  if (!record || !run.has(record.targetId)) {
    run.emit(trace, {
      type: 'DNS_RESOLVED',
      status: 'error',
      sourceId: dnsConn.targetId,
      targetId: clientId,
      connectionId: dnsConn.id,
      duration: run.latency(dnsConn),
      failure: 'dns',
      data: { rcode: 'NXDOMAIN', host: cp.targetHost },
      message: `DNS: NXDOMAIN para ${cp.targetHost}`,
      basic: 'El nombre no existe en el DNS.',
      advanced: 'No hay registro para el host solicitado.'
    });
    return fail(run, trace, clientId, path, 'dns', `NXDOMAIN ${cp.targetHost}`, 'DNS_RESOLUTION_FAILED');
  }
  run.emit(trace, {
    type: 'DNS_RESOLVED',
    status: 'success',
    sourceId: dnsConn.targetId,
    targetId: clientId,
    connectionId: dnsConn.id,
    duration: run.latency(dnsConn),
    data: { host: cp.targetHost, resolvedTo: record.targetId, ttl: 60 },
    message: `DNS: ${cp.targetHost} → ${run.name(record.targetId)}`,
    basic: `El DNS responde: la aplicación está en ${run.name(record.targetId)}.`,
    advanced: `Registro ALIAS hacia ${record.targetId} (TTL 60 s supuesto).`
  });

  // ---- Ruta y handshake ----
  const dest = record.targetId;
  const route = findPath(run.model, clientId, dest);
  if (!route) return fail(run, trace, clientId, path, 'network', `Sin ruta de red hacia ${run.name(dest)}`, 'CONNECTION_REFUSED');
  const entry = route[route.length - 1]!;
  const sendStart = run.clock;
  for (const seg of route) {
    run.emit(trace, {
      type: 'CONNECTION_ATTEMPTED',
      status: 'active',
      sourceId: seg.sourceId,
      targetId: seg.targetId,
      connectionId: seg.id,
      duration: run.latency(seg),
      data: { protocol: seg.protocol, port: seg.port, tcp: 'SYN' },
      message: `TCP SYN ${run.name(seg.sourceId)} → ${run.name(seg.targetId)} (${seg.protocol}:${seg.port})`,
      basic: 'Se intenta abrir la conexión.',
      advanced: `Primer paquete del handshake TCP hacia :${entry.port}.`
    });
    const node = seg.targetId;
    if (!path.includes(node)) path.push(node);
    if (!run.isAvailable(node)) {
      run.emit(trace, {
        type: 'SERVICE_UNAVAILABLE',
        status: 'error',
        sourceId: node,
        failure: 'availability',
        message: `${run.name(node)} no responde`,
        basic: `${run.name(node)} está caído.`,
        advanced: 'El SYN no recibe respuesta.'
      });
      return clientTimeout(run, trace, clientId, path, sendStart, cp.timeoutMs, 'availability', `${run.name(node)} caído`);
    }
    if (run.behavior(node) === 'firewall') {
      const fp = firewallProps(run.comp(node));
      run.clock += fp.inspectMs;
      const verdict = evaluateFirewall(fp.rules, fp.defaultAction, { protocol: seg.protocol, port: seg.port, sourceIp: cp.sourceIp });
      const ruleTxt = verdict.rule ? `regla "${verdict.rule.id}" (prioridad ${verdict.rule.priority})` : `acción por defecto (${fp.defaultAction})`;
      if (verdict.action === 'deny') {
        run.emit(trace, {
          type: 'ACCESS_DENIED',
          status: 'error',
          sourceId: node,
          failure: 'network',
          data: { protocol: seg.protocol, port: seg.port, sourceIp: cp.sourceIp, ruleId: verdict.rule?.id ?? 'default', action: 'deny', rejectMode: fp.rejectMode },
          message: `${run.name(node)} DENIEGA ${seg.protocol}:${seg.port} desde ${cp.sourceIp} por ${ruleTxt}`,
          basic: `El firewall bloquea la conexión por una regla de seguridad.`,
          advanced: `${verdict.rule?.description ? `"${verdict.rule.description}". ` : ''}Primera coincidencia por prioridad. Modo ${fp.rejectMode === 'reject' ? 'reject: se envía TCP RST' : 'drop: descarte silencioso'}.`
        });
        if (fp.rejectMode === 'drop') return clientTimeout(run, trace, clientId, path, sendStart, cp.timeoutMs, 'network', `Firewall descarta ${seg.protocol}:${seg.port}`);
        const back = route.slice(0, route.indexOf(seg) + 1).reverse();
        for (const b of back) {
          run.emit(trace, {
            type: 'CONNECTION_REFUSED',
            status: 'error',
            sourceId: b.targetId,
            targetId: b.sourceId,
            connectionId: b.id,
            duration: run.latency(b),
            failure: 'network',
            data: { tcp: 'RST', port: seg.port },
            message: `TCP RST ${run.name(b.targetId)} → ${run.name(b.sourceId)}`,
            basic: 'Vuelve el aviso de conexión rechazada.',
            advanced: 'El cliente recibe ECONNREFUSED casi de inmediato.'
          });
        }
        return { outcome: { kind: 'refused', failure: 'network', reason: `Firewall: ${ruleTxt}` }, path };
      }
      run.emit(trace, {
        type: 'RULE_EVALUATED',
        status: 'success',
        sourceId: node,
        data: { protocol: seg.protocol, port: seg.port, sourceIp: cp.sourceIp, ruleId: verdict.rule?.id ?? 'default', action: 'allow' },
        message: `${run.name(node)} PERMITE ${seg.protocol}:${seg.port} por ${ruleTxt}`,
        basic: 'El firewall revisa sus reglas y deja pasar la conexión.',
        advanced: 'Stateful: la conexión queda registrada en la tabla de estado y las respuestas regresan sin reevaluar reglas.'
      });
    }
  }
  const rtt = route.reduce((s, k) => s + run.latency(k), 0);
  run.emit(trace, {
    type: 'CONNECTION_ESTABLISHED',
    status: 'success',
    sourceId: clientId,
    duration: rtt,
    data: { protocol: entry.protocol, port: entry.port, with: dest, rttMs: rtt },
    message: `Conexión TCP establecida con ${run.name(dest)} (RTT ${rtt} ms)`,
    basic: 'La conexión quedó abierta.',
    advanced: 'SYN-ACK y ACK completan el handshake de 3 vías.'
  });
  if (entry.protocol === 'HTTPS') {
    run.emit(trace, {
      type: 'TLS_HANDSHAKE_COMPLETED',
      status: 'success',
      sourceId: clientId,
      duration: rtt,
      data: { tls: 'TLS 1.3', terminatedAt: dest },
      message: `TLS 1.3 negociado con ${run.name(dest)}`,
      basic: 'Se establece un canal cifrado.',
      advanced: 'TLS 1.3 (1-RTT). El certificado se valida contra el nombre DNS.'
    });
  }

  // ---- Solicitud ----
  const reqStart = run.clock;
  for (const seg of route) {
    run.emit(trace, {
      type: 'REQUEST_SENT',
      status: 'active',
      sourceId: seg.sourceId,
      targetId: seg.targetId,
      connectionId: seg.id,
      duration: run.latency(seg),
      data: { protocol: seg.protocol, port: seg.port, method: req.method, path: req.path, headers: req.headers, payload: req.payload },
      message: `${req.method} ${req.path}: ${run.name(seg.sourceId)} → ${run.name(seg.targetId)}`,
      basic: 'La solicitud viaja hacia la aplicación.',
      advanced: `${seg.protocol}:${seg.port}${seg.props.encrypted ? ' (cifrado TLS)' : ''}.`
    });
  }
  run.emit(trace, {
    type: 'REQUEST_RECEIVED',
    status: 'info',
    sourceId: dest,
    data: { method: req.method, path: req.path },
    message: `${run.name(dest)} recibe ${req.method} ${req.path}`,
    basic: `${run.name(dest)} recibe la solicitud.`,
    advanced: `Entrada por ${entry.protocol}:${entry.port}.`
  });
  const before = run.events.length;
  const out = handleRequest(run, dest, req, trace);
  for (const e of run.events.slice(before)) {
    for (const id of [e.sourceId, e.targetId]) if (id && !path.includes(id)) path.push(id);
  }
  if (out.kind !== 'response') return clientTimeout(run, trace, clientId, path, reqStart, cp.timeoutMs, out.failure, out.reason);
  for (const seg of [...route].reverse()) {
    run.emit(trace, {
      type: 'RESPONSE_SENT',
      status: isOk(out) ? 'success' : 'error',
      sourceId: seg.targetId,
      targetId: seg.sourceId,
      connectionId: seg.id,
      duration: run.latency(seg),
      ...(out.failure ? { failure: out.failure } : {}),
      data: { protocol: seg.protocol, port: seg.port, httpStatus: out.status, ...(out.body ? { payload: out.body } : {}) },
      message: `${statusText(out.status)}: ${run.name(seg.targetId)} → ${run.name(seg.sourceId)}`,
      basic: 'La respuesta regresa al usuario.',
      advanced: 'Respuesta por la misma conexión (stateful).'
    });
  }
  run.emit(trace, {
    type: 'RESPONSE_RECEIVED',
    status: isOk(out) ? 'success' : 'error',
    sourceId: clientId,
    ...(out.failure ? { failure: out.failure } : {}),
    data: { httpStatus: out.status, ...(out.body ? { payload: out.body } : {}) },
    message: `${run.name(clientId)} recibe ${statusText(out.status)}`,
    basic: isOk(out) ? 'El usuario recibe la respuesta correcta.' : 'El usuario recibe un error.',
    advanced: out.error ? `Causa: ${out.error}.` : 'Solicitud completada.'
  });
  return { outcome: out, path };
}

function clientTimeout(run: Run, trace: Trace, clientId: string, path: string[], start: number, timeoutMs: number, failure: FailureCategory, reason: string): ClientResult {
  run.clock = Math.max(run.clock, start + timeoutMs);
  run.emit(trace, {
    type: 'CONNECTION_TIMEOUT',
    status: 'error',
    sourceId: clientId,
    failure,
    data: { timeoutMs },
    message: `${run.name(clientId)}: timeout tras ${timeoutMs} ms`,
    basic: 'El usuario se queda esperando hasta que el navegador se rinde.',
    advanced: 'Sin respuesta ni rechazo explícito: el cliente agota su timeout.'
  });
  return { outcome: { kind: 'no_response', failure, reason }, path };
}

function fail(run: Run, trace: Trace, clientId: string, path: string[], failure: 'dns' | 'network', reason: string, type: 'DNS_RESOLUTION_FAILED' | 'CONNECTION_REFUSED'): ClientResult {
  run.emit(trace, {
    type,
    status: 'error',
    sourceId: clientId,
    failure,
    data: { reason },
    message: reason,
    basic: failure === 'dns' ? 'No se pudo averiguar dónde está la aplicación.' : 'No existe un camino de red hacia el destino.',
    advanced: reason
  });
  return { outcome: { kind: 'refused', failure, reason }, path };
}

