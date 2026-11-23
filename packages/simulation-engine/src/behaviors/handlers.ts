/**
 * Comportamientos por tipo (BehaviorKind). Cada handler interpreta propiedades del modelo y emite
 * eventos. Aquí viven las reglas técnicas; el motor 3D no conoce ninguna.
 */
import type { Connection, FailureCategory } from '@asa/core-model';
import { datastoreProps, gatewayProps, lbProps, serviceProps } from '@asa/core-model';
import { matchSecurityGroup } from '../net';
import type { Run, Trace } from '../run';
import type { Outcome, SimRequest } from './types';
import { isOk } from './types';

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
};
export const statusText = (s: number) => `${s} ${STATUS_TEXT[s] ?? ''}`.trim();

/** Punto de entrada para un componente que recibe una solicitud HTTP. */
export function handleRequest(run: Run, nodeId: string, req: SimRequest, trace: Trace): Outcome {
  switch (run.behavior(nodeId)) {
    case 'load_balancer':
      return handleLoadBalancer(run, nodeId, req, trace);
    case 'api_gateway':
      return handleGateway(run, nodeId, req, trace);
    case 'service':
      return handleService(run, nodeId, req, trace);
    case 'transit':
      return handleTransit(run, nodeId, req, trace);
    case 'datastore':
      return serveApi(run, nodeId, trace);
    default:
      run.emit(trace, {
        type: 'ERROR_RETURNED',
        status: 'error',
        sourceId: nodeId,
        failure: 'application',
        data: { httpStatus: 501 },
        message: `${run.name(nodeId)} no procesa solicitudes HTTP`,
        basic: 'Este componente no sabe atender este tipo de solicitud.',
        advanced: `El comportamiento "${run.behavior(nodeId)}" no actúa como destino HTTP en el modelo.`
      });
      return { kind: 'response', status: 501, error: 'Destino no HTTP', failure: 'application' };
  }
}

/** Envía una solicitud HTTP por una conexión directa y devuelve la respuesta (o su ausencia). */
export function forwardHttp(run: Run, conn: Connection, req: SimRequest, trace: Trace): Outcome {
  const from = conn.sourceId;
  const to = conn.targetId;
  run.emit(trace, {
    type: 'REQUEST_SENT',
    status: 'active',
    sourceId: from,
    targetId: to,
    connectionId: conn.id,
    duration: run.latency(conn),
    data: { protocol: conn.protocol, port: conn.port, method: req.method, path: req.path, headers: req.headers, payload: req.payload },
    message: `${run.name(from)} → ${run.name(to)}: ${req.method} ${req.path} (${conn.protocol}:${conn.port})`,
    basic: `${run.name(from)} reenvía la solicitud a ${run.name(to)}.`,
    advanced: `Tramo ${conn.protocol}:${conn.port}, latencia estimada ${run.latency(conn)} ms${conn.props.encrypted ? ', cifrado' : ', sin cifrado (red privada)'}.`
  });
  if (!run.isAvailable(to)) {
    run.emit(trace, {
      type: 'SERVICE_UNAVAILABLE',
      status: 'error',
      sourceId: to,
      failure: 'availability',
      message: `${run.name(to)} no responde (instancia caída)`,
      basic: `${run.name(to)} está apagado o caído: la solicitud no obtiene respuesta.`,
      advanced: 'La conexión TCP no se completa; el llamador sólo lo detecta al vencer su timeout.'
    });
    return { kind: 'no_response', failure: 'availability', reason: `${run.name(to)} caído` };
  }
  run.emit(trace, {
    type: 'REQUEST_RECEIVED',
    status: 'info',
    sourceId: to,
    data: { method: req.method, path: req.path },
    message: `${run.name(to)} recibe ${req.method} ${req.path}`,
    basic: `${run.name(to)} recibe la solicitud.`,
    advanced: `Solicitud aceptada en ${conn.protocol}:${conn.port}.`
  });
  const out = handleRequest(run, to, req, trace);
  if (out.kind === 'response') {
    run.emit(trace, {
      type: 'RESPONSE_SENT',
      status: isOk(out) ? 'success' : 'error',
      sourceId: to,
      targetId: from,
      connectionId: conn.id,
      duration: run.latency(conn),
      ...(out.failure ? { failure: out.failure } : {}),
      data: { protocol: conn.protocol, port: conn.port, httpStatus: out.status, ...(out.body ? { payload: out.body } : {}) },
      message: `${run.name(to)} → ${run.name(from)}: ${statusText(out.status)}`,
      basic: isOk(out) ? `${run.name(to)} devuelve la respuesta.` : `${run.name(to)} devuelve un error ${out.status}.`,
      advanced: out.error ? `Causa: ${out.error}.` : `Respuesta ${statusText(out.status)} por ${conn.protocol}.`
    });
  }
  return out;
}

/**
 * Tránsito usado como salto intermedio por un servicio (VPC endpoint, NAT, VPN): reenvía al
 * siguiente componente. Si hay varios destinos usa el primero (orden determinista por ID).
 */
function handleTransit(run: Run, id: string, req: SimRequest, trace: Trace): Outcome {
  const next = run.outgoing(id).filter((k) => k.protocol !== 'DNS');
  if (!next.length) {
    run.emit(trace, {
      type: 'ERROR_RETURNED',
      status: 'error',
      sourceId: id,
      failure: 'network',
      data: { httpStatus: 502 },
      message: `${run.name(id)} no tiene un destino al que reenviar → 502`,
      basic: 'Este componente de red no lleva a ningún servicio.',
      advanced: 'El tránsito no tiene conexiones salientes en el modelo: revise el diagrama o agregue la conexión al servicio que expone.'
    });
    return { kind: 'response', status: 502, error: `${run.name(id)} sin destino`, failure: 'network' };
  }
  const k = next[0]!;
  const out = forwardHttp(run, k, req, trace);
  return out.kind === 'response' ? out : { kind: 'response', status: 504, error: out.reason, failure: out.failure };
}

/** Almacén o API gestionada alcanzada por HTTP (p. ej. a través de un endpoint privado). */
function serveApi(run: Run, id: string, trace: Trace): Outcome {
  const d = datastoreProps(run.comp(id));
  run.clock += d.queryMs;
  run.emit(trace, {
    type: 'PROCESSING_STARTED',
    status: 'active',
    sourceId: id,
    data: { engine: d.engine, queryMs: d.queryMs },
    message: `${run.name(id)} atiende la solicitud (${d.queryMs} ms)`,
    basic: `${run.name(id)} responde a la llamada.`,
    advanced: `Servicio gestionado/externo accedido por HTTPS; latencia estimada ${d.queryMs} ms.`
  });
  return { kind: 'response', status: 200, body: { from: id, source: 'synthetic' } };
}

function handleLoadBalancer(run: Run, id: string, req: SimRequest, trace: Trace): Outcome {
  const p = lbProps(run.comp(id));
  run.clock += p.processingMs;
  const targets = run.outgoing(id).filter((k) => k.protocol === 'HTTP' || k.protocol === 'HTTPS');
  let healthy = targets;
  if (p.healthChecks) {
    healthy = targets.filter((k) => run.isAvailable(k.targetId));
    for (const k of targets.filter((x) => !healthy.includes(x))) {
      run.emit(trace, {
        type: 'HEALTH_CHECK_FAILED',
        status: 'warning',
        sourceId: id,
        data: { target: k.targetId },
        message: `Health check: ${run.name(k.targetId)} no saludable, excluido`,
        basic: `El balanceador detecta que ${run.name(k.targetId)} no está sano y no le envía tráfico.`,
        advanced: 'Los health checks periódicos marcaron el destino como unhealthy antes de esta solicitud.'
      });
    }
  }
  if (!healthy.length) {
    run.emit(trace, {
      type: 'SERVICE_UNAVAILABLE',
      status: 'error',
      sourceId: id,
      failure: 'availability',
      data: { httpStatus: 503 },
      message: `${run.name(id)} sin destinos saludables → 503`,
      basic: 'No queda ningún servidor disponible para atender.',
      advanced: 'Todos los destinos registrados están unhealthy; el balanceador responde 503 directamente.'
    });
    return { kind: 'response', status: 503, error: 'Sin destinos saludables', failure: 'availability' };
  }
  const n = run.roundRobin.get(id) ?? 0;
  run.roundRobin.set(id, n + 1);
  const chosen = healthy[n % healthy.length]!;
  run.emit(trace, {
    type: 'BACKEND_SELECTED',
    status: 'info',
    sourceId: id,
    data: { target: chosen.targetId, algorithm: p.algorithm, candidates: healthy.map((k) => k.targetId) },
    message: `${run.name(id)} selecciona ${run.name(chosen.targetId)} (round robin)`,
    basic: `El balanceador elige ${run.name(chosen.targetId)} para atender esta solicitud.`,
    advanced: `Round robin sobre ${healthy.length} destino(s) saludable(s). TLS terminado en el balanceador; reenvía ${chosen.protocol}:${chosen.port}.`
  });
  const start = run.clock;
  const out = forwardHttp(run, chosen, req, trace);
  if (out.kind !== 'response') {
    run.clock = start + p.targetTimeoutMs;
    run.emit(trace, {
      type: 'CONNECTION_TIMEOUT',
      status: 'error',
      sourceId: id,
      failure: out.failure,
      data: { timeoutMs: p.targetTimeoutMs, httpStatus: 504 },
      message: `${run.name(id)}: sin respuesta de ${run.name(chosen.targetId)} tras ${p.targetTimeoutMs} ms → 504`,
      basic: 'El balanceador esperó demasiado y se rindió.',
      advanced: p.healthChecks
        ? 'El destino falló entre health checks.'
        : 'Sin health checks el balanceador enruta a destinos caídos; la falla aparece como 504.'
    });
    return { kind: 'response', status: 504, error: out.reason, failure: out.failure };
  }
  return out;
}

function handleGateway(run: Run, id: string, req: SimRequest, trace: Trace): Outcome {
  const p = gatewayProps(run.comp(id));
  const forced = run.httpErrorFault(id);
  if (forced) {
    const failure = forced.status === 429 ? 'capacity' : 'application';
    run.emit(trace, {
      type: 'ERROR_RETURNED',
      status: 'error',
      sourceId: id,
      failure,
      data: { httpStatus: forced.status },
      message: `${run.name(id)} responde ${statusText(forced.status)}`,
      basic: forced.status === 429 ? 'Se superó el límite de solicitudes permitido.' : 'El gateway devolvió un error.',
      advanced: forced.status === 429 ? 'Throttling: la cuota o el burst limit del stage fue excedido; el cliente debe reintentar con backoff.' : 'Falla inyectada por el escenario.'
    });
    return { kind: 'response', status: forced.status, error: `Falla inyectada ${forced.status}`, failure };
  }
  if (p.requireAuth) {
    run.emit(trace, {
      type: 'AUTHENTICATION_STARTED',
      status: 'active',
      sourceId: id,
      duration: 3,
      data: { headers: { Authorization: req.auth === 'missing' ? '(ausente)' : 'Bearer eyJ…(sintético)' } },
      message: `${run.name(id)} valida el token`,
      basic: 'El gateway comprueba que la solicitud traiga una credencial válida.',
      advanced: 'Autorizador JWT/OIDC: firma, expiración y audiencia.'
    });
    if (req.auth !== 'valid') {
      run.emit(trace, {
        type: 'AUTHENTICATION_FAILED',
        status: 'error',
        sourceId: id,
        failure: 'authentication',
        data: { httpStatus: 401, reason: req.auth },
        message: `Autenticación fallida (${req.auth === 'missing' ? 'token ausente' : 'token inválido'}) → 401`,
        basic: 'La credencial no es válida: el gateway rechaza sin llamar al backend.',
        advanced: 'Se corta en el borde: la integración no se invoca y no consume cómputo.'
      });
      return { kind: 'response', status: 401, error: 'Token inválido o ausente', failure: 'authentication' };
    }
    run.emit(trace, {
      type: 'AUTHENTICATION_SUCCEEDED',
      status: 'success',
      sourceId: id,
      message: 'Token válido',
      basic: 'La credencial es válida.',
      advanced: 'Claims verificados; el contexto de identidad se propaga a la integración.'
    });
  }
  run.clock += p.processingMs;
  const integration = run.outgoing(id).find((k) => k.protocol === 'HTTPS' || k.protocol === 'HTTP');
  if (!integration) {
    return { kind: 'response', status: 500, error: 'Gateway sin integración', failure: 'application' };
  }
  const start = run.clock;
  const out = forwardHttp(run, integration, req, trace);
  if (out.kind !== 'response') {
    run.clock = start + p.integrationTimeoutMs;
    run.emit(trace, {
      type: 'CONNECTION_TIMEOUT',
      status: 'error',
      sourceId: id,
      failure: out.failure,
      data: { timeoutMs: p.integrationTimeoutMs, httpStatus: 504 },
      message: `Integración sin respuesta tras ${p.integrationTimeoutMs} ms → 504`,
      basic: 'El servicio de atrás no respondió a tiempo.',
      advanced: 'Timeout de integración del gateway.'
    });
    return { kind: 'response', status: 504, error: out.reason, failure: out.failure };
  }
  return out;
}

function handleService(run: Run, id: string, req: SimRequest, trace: Trace): Outcome {
  const p = serviceProps(run.comp(id));
  const forced = run.httpErrorFault(id);
  run.emit(trace, {
    type: 'PROCESSING_STARTED',
    status: 'active',
    sourceId: id,
    duration: p.processingMs,
    data: { runtime: p.runtime },
    message: `${run.name(id)} procesa ${req.method} ${req.path}`,
    basic: `${run.name(id)} ejecuta la lógica de negocio.`,
    advanced: `Runtime ${p.runtime}; tiempo de procesamiento estimado ${p.processingMs} ms.`
  });
  if (forced) {
    run.emit(trace, {
      type: 'ERROR_RETURNED',
      status: 'error',
      sourceId: id,
      failure: 'application',
      data: { httpStatus: forced.status },
      message: `${run.name(id)} falla con ${statusText(forced.status)}`,
      basic: 'La aplicación produjo un error.',
      advanced: 'Error de aplicación inyectado por el escenario (p.ej. excepción no controlada).'
    });
    return { kind: 'response', status: forced.status, error: `Error de aplicación ${forced.status}`, failure: 'application' };
  }
  const rows: Record<string, unknown> = {};
  for (const dep of run.outgoing(id)) {
    const r = callDependency(run, id, dep, req, trace);
    if (!r.ok) {
      const status = r.failure === 'authorization' ? 500 : 503;
      run.emit(trace, {
        type: 'ERROR_RETURNED',
        status: 'error',
        sourceId: id,
        failure: r.failure,
        data: { httpStatus: status, dependency: dep.targetId },
        message: `${run.name(id)} no pudo usar ${run.name(dep.targetId)} → ${statusText(status)}`,
        basic: `Como ${run.name(dep.targetId)} falló, ${run.name(id)} responde con error.`,
        advanced:
          r.failure === 'authorization'
            ? 'Un AccessDenied de una dependencia es un error no recuperable por reintento: se traduce en 500.'
            : 'Dependencia no disponible: se responde 503 para que el cliente pueda reintentar más tarde.'
      });
      return { kind: 'response', status, error: r.reason, failure: r.failure };
    }
    Object.assign(rows, r.data);
  }
  return { kind: 'response', status: 200, body: { ...req.payload, status: 'APPROVED', total: 1250.5, source: 'synthetic', ...rows } };
}

type DepResult = { ok: true; data: Record<string, unknown> } | { ok: false; failure: FailureCategory; reason: string; retryable: boolean };

/** Llamada a dependencia con timeouts, reintentos con backoff exponencial y circuit breaker. */
function callDependency(run: Run, serviceId: string, conn: Connection, req: SimRequest, trace: Trace): DepResult {
  const p = serviceProps(run.comp(serviceId));
  const cb = p.circuitBreaker;
  const key = `${serviceId}->${conn.targetId}`;
  const br = run.breaker(key);
  const attempts = 1 + Math.max(0, p.retries);
  let last: DepResult = { ok: false, failure: 'availability', reason: 'sin intentos', retryable: false };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (cb.enabled && br.state === 'open') {
      if (run.clock - br.openedAt >= cb.resetTimeoutMs) {
        br.state = 'half_open';
      } else {
        run.emit(trace, {
          type: 'CIRCUIT_BREAKER_REJECTED',
          status: 'error',
          sourceId: serviceId,
          failure: 'availability',
          data: { dependency: conn.targetId, openedAt: br.openedAt, resetTimeoutMs: cb.resetTimeoutMs },
          message: `Circuit breaker abierto: ${run.name(serviceId)} falla rápido sin llamar a ${run.name(conn.targetId)}`,
          basic: 'El servicio ya sabe que la dependencia está caída y no la vuelve a esperar.',
          advanced: `Fail-fast: se evita consumir ${p.timeoutMs} ms × intentos. Se probará de nuevo (half-open) a los ${cb.resetTimeoutMs} ms de abierto.`
        });
        return { ok: false, failure: 'availability', reason: 'Circuit breaker abierto', retryable: false };
      }
    }
    if (attempt > 1) {
      const backoff = p.retryBackoffMs * 2 ** (attempt - 2);
      run.emit(trace, {
        type: 'RETRY_STARTED',
        status: 'warning',
        sourceId: serviceId,
        duration: backoff,
        data: { attempt, backoffMs: backoff, dependency: conn.targetId },
        message: `Reintento ${attempt - 1}/${attempts - 1} hacia ${run.name(conn.targetId)} tras ${backoff} ms`,
        basic: 'El servicio vuelve a intentar la operación.',
        advanced: `Backoff exponencial base ${p.retryBackoffMs} ms. Cada intento puede consumir hasta ${p.timeoutMs} ms.`
      });
    }
    last = attemptCall(run, serviceId, conn, req, trace, attempt);
    if (last.ok) {
      if (br.state === 'half_open' || br.failures > 0) {
        const wasOpen = br.state === 'half_open';
        br.state = 'closed';
        br.failures = 0;
        if (wasOpen) {
          run.emit(trace, {
            type: 'CIRCUIT_BREAKER_CLOSED',
            status: 'success',
            sourceId: serviceId,
            data: { dependency: conn.targetId },
            message: `Circuit breaker cerrado: ${run.name(conn.targetId)} volvió a responder`,
            basic: 'La dependencia se recuperó y el tráfico vuelve a la normalidad.',
            advanced: 'La llamada de prueba (half-open) tuvo éxito.'
          });
        }
      }
      return last;
    }
    br.failures++;
    if (cb.enabled && (br.state === 'half_open' || br.failures >= cb.failureThreshold)) {
      br.state = 'open';
      br.openedAt = run.clock;
      run.emit(trace, {
        type: 'CIRCUIT_BREAKER_OPENED',
        status: 'warning',
        sourceId: serviceId,
        data: { dependency: conn.targetId, failures: br.failures, threshold: cb.failureThreshold },
        message: `Circuit breaker ABIERTO hacia ${run.name(conn.targetId)} (${br.failures} fallas)`,
        basic: 'Tras varias fallas seguidas, el servicio deja de insistir por un tiempo.',
        advanced: `Umbral ${cb.failureThreshold} fallas consecutivas. Protege hilos y pool de conexiones frente a fallas en cascada.`
      });
      return { ...last, retryable: false };
    }
    if (!last.retryable) return last;
  }
  return last;
}

function attemptCall(run: Run, serviceId: string, conn: Connection, req: SimRequest, trace: Trace, attempt: number): DepResult {
  const target = conn.targetId;
  const p = serviceProps(run.comp(serviceId));
  if (run.behavior(target) !== 'datastore') {
    const start = run.clock;
    const out = forwardHttp(run, conn, req, trace);
    if (out.kind === 'response') {
      return isOk(out)
        ? { ok: true, data: out.body ?? {} }
        : { ok: false, failure: out.failure ?? 'application', reason: out.error ?? `HTTP ${out.status}`, retryable: out.status >= 500 };
    }
    run.clock = start + p.timeoutMs;
    run.emit(trace, timeoutEvent(run, serviceId, target, p.timeoutMs, out.failure, attempt));
    return { ok: false, failure: out.failure, reason: out.reason, retryable: true };
  }

  // ---- Acceso a datastore ----
  const d = datastoreProps(run.comp(target));
  if (conn.protocol === 'JDBC') {
    if (run.poolExhausted(serviceId)) {
      run.emit(trace, {
        type: 'POOL_EXHAUSTED',
        status: 'error',
        sourceId: serviceId,
        failure: 'capacity',
        duration: p.timeoutMs,
        data: { poolSize: p.poolSize, waitedMs: p.timeoutMs },
        message: `Pool de conexiones agotado (${p.poolSize}/${p.poolSize} en uso)`,
        basic: 'No hay conexiones libres hacia la base de datos.',
        advanced: 'Todas las conexiones del pool están ocupadas (p.ej. por consultas lentas o fugas); la espera vence sin obtener conexión.'
      });
      return { ok: false, failure: 'capacity', reason: 'Pool agotado', retryable: false };
    }
    run.emit(trace, {
      type: 'POOL_CONNECTION_ACQUIRED',
      status: 'info',
      sourceId: serviceId,
      data: { poolSize: p.poolSize, attempt },
      message: `${run.name(serviceId)} toma una conexión del pool`,
      basic: 'Se reutiliza una conexión ya abierta hacia la base de datos.',
      advanced: `Pool de ${p.poolSize} conexiones; evita el costo de handshake TCP+TLS+auth por consulta.`
    });
  }
  const start = run.clock;
  const isSql = conn.protocol === 'JDBC';
  run.emit(trace, {
    type: 'DATABASE_QUERY_STARTED',
    status: 'active',
    sourceId: serviceId,
    targetId: target,
    connectionId: conn.id,
    duration: run.latency(conn),
    data: {
      protocol: conn.protocol,
      port: conn.port,
      attempt,
      ...(isSql
        ? { statement: 'SELECT id, status, total FROM orders WHERE id = $1', params: [String(req.payload['orderId'] ?? 'ORD-0')] }
        : { operation: d.requiredAction || 'llamada API', key: { pk: String(req.payload['orderId'] ?? req.payload['requestId'] ?? 'ORD-0') } })
    },
    message: `${run.name(serviceId)} → ${run.name(target)}: ${isSql ? 'consulta SQL' : d.requiredAction || 'llamada API'}${attempt > 1 ? ` (intento ${attempt})` : ''}`,
    basic: `${run.name(serviceId)} pide datos a ${run.name(target)}.`,
    advanced: `${conn.protocol}:${conn.port}, latencia estimada ${run.latency(conn)} ms.`
  });

  if (!run.isAvailable(target)) {
    const failover = run.failoverInProgress(target);
    run.emit(trace, {
      type: 'SERVICE_UNAVAILABLE',
      status: 'error',
      sourceId: target,
      failure: 'availability',
      data: { multiAz: d.multiAz, failoverInProgress: failover },
      message: failover ? `${run.name(target)}: failover a standby en curso, no responde` : `${run.name(target)} no disponible`,
      basic: failover ? 'La base de datos está cambiando a su copia de respaldo.' : 'La base de datos no responde.',
      advanced: failover
        ? `Multi-AZ: el endpoint se reasigna a la standby; tiempo estimado ${d.failoverMs} ms.`
        : 'Instancia única sin standby: no hay a dónde conmutar. Cada intento espera el timeout completo.'
    });
    run.clock = start + p.timeoutMs;
    run.emit(trace, timeoutEvent(run, serviceId, target, p.timeoutMs, 'availability', attempt));
    return { ok: false, failure: 'availability', reason: `${run.name(target)} no disponible`, retryable: true };
  }

  if (d.securityGroup.enabled && !matchSecurityGroup(d.securityGroup.inbound, { protocol: conn.protocol, port: conn.port, sourceId: serviceId })) {
    run.emit(trace, {
      type: 'PACKET_DROPPED',
      status: 'error',
      sourceId: target,
      failure: 'network',
      observable: false,
      data: { protocol: conn.protocol, port: conn.port, callerId: serviceId, rules: d.securityGroup.inbound },
      message: `Security Group de ${run.name(target)} descarta ${conn.protocol}:${conn.port} desde ${run.name(serviceId)}`,
      basic: 'Una regla de red impide que el tráfico llegue a la base de datos.',
      advanced:
        'Los Security Groups descartan en silencio (no envían RST): el llamador sólo ve un timeout. Sólo visible con flow logs habilitados; en la simulación se muestra explícitamente.'
    });
    run.clock = start + p.timeoutMs;
    run.emit(trace, timeoutEvent(run, serviceId, target, p.timeoutMs, 'network', attempt));
    return { ok: false, failure: 'network', reason: `Security Group bloquea ${conn.protocol}:${conn.port}`, retryable: true };
  }

  if (d.requiresIam && !(p.iamPermissions.includes('*') || p.iamPermissions.includes(d.requiredAction))) {
    run.emit(trace, {
      type: 'ACCESS_DENIED',
      status: 'error',
      sourceId: target,
      failure: 'authorization',
      data: { requiredAction: d.requiredAction, granted: p.iamPermissions, callerId: serviceId, httpStatus: 403 },
      message: `IAM: ${run.name(serviceId)} no tiene ${d.requiredAction} → AccessDenied`,
      basic: 'El servicio no tiene permiso para leer estos datos.',
      advanced: `La red funciona; falla la autorización. El rol del llamador carece de la acción ${d.requiredAction}. Reintentar no ayuda.`
    });
    run.emit(trace, {
      type: 'ERROR_RETURNED',
      status: 'error',
      sourceId: target,
      targetId: serviceId,
      connectionId: conn.id,
      duration: run.latency(conn),
      failure: 'authorization',
      data: { httpStatus: 403, error: 'AccessDeniedException' },
      message: `${run.name(target)} → ${run.name(serviceId)}: 403 AccessDeniedException`,
      basic: 'Se devuelve un error de permisos.',
      advanced: 'Error de autorización explícito (no timeout).'
    });
    return { ok: false, failure: 'authorization', reason: `Falta permiso ${d.requiredAction}`, retryable: false };
  }

  run.clock += d.queryMs;
  const result = isSql ? { rows: 1, orderStatus: 'APPROVED' } : { item: { pk: String(req.payload['orderId'] ?? 'ORD-0'), status: 'APPROVED' } };
  run.emit(trace, {
    type: 'DATABASE_QUERY_COMPLETED',
    status: 'success',
    sourceId: target,
    targetId: serviceId,
    connectionId: conn.id,
    duration: run.latency(conn),
    data: { protocol: conn.protocol, port: conn.port, result, queryMs: d.queryMs },
    message: `${run.name(target)} → ${run.name(serviceId)}: resultado (${d.queryMs} ms)`,
    basic: 'La base de datos devuelve los datos pedidos.',
    advanced: `Tiempo de consulta estimado ${d.queryMs} ms (${d.engine}).`
  });
  return { ok: true, data: { db: result } };
}

function timeoutEvent(run: Run, serviceId: string, target: string, timeoutMs: number, failure: FailureCategory, attempt: number) {
  return {
    type: 'CONNECTION_TIMEOUT' as const,
    status: 'error' as const,
    sourceId: serviceId,
    failure,
    data: { timeoutMs, attempt, dependency: target },
    message: `${run.name(serviceId)}: timeout esperando a ${run.name(target)} (${timeoutMs} ms, intento ${attempt})`,
    basic: `${run.name(serviceId)} esperó ${timeoutMs} ms sin respuesta.`,
    advanced: 'Desde el llamador, un destino caído y un paquete descartado por red son indistinguibles: ambos terminan en timeout.'
  };
}
