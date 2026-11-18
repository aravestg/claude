/**
 * Diagnóstico basado en reglas (sin IA): a partir del resultado de una simulación identifica la
 * causa raíz y propone recomendaciones con el formato de la sección 12. Cada recomendación puede
 * llevar una ChangeProposal en estado "pending" que requiere aprobación del usuario.
 */
import type { ArchitectureModel, ChangeProposal, Recommendation, SimulationEvent, SimulationResult } from '@asa/core-model';
import { createProposal, datastoreProps, firewallProps, getDefinition, lbProps, serviceProps } from '@asa/core-model';

export function diagnose(model: ArchitectureModel, result: SimulationResult): Recommendation[] {
  const byId = new Map(result.events.map((e) => [e.id, e]));
  const recs = new Map<string, Recommendation>();
  const add = (r: Recommendation) => {
    if (!recs.has(r.id)) recs.set(r.id, r);
  };
  const proposal = (id: string, title: string, rationale: string, operations: ChangeProposal['operations']) =>
    createProposal(model, { id: `prop-${id}`, source: 'rule-engine', title, rationale, operations });
  const name = (id: string) => model.components.find((c) => c.id === id)?.name ?? id;
  const behavior = (id: string) => {
    const c = model.components.find((x) => x.id === id);
    return c ? getDefinition(c.type).behavior : undefined;
  };

  for (const req of result.requests.filter((r) => !r.ok)) {
    const root: SimulationEvent | undefined = req.rootCauseEventId ? byId.get(req.rootCauseEventId) : undefined;
    if (!root?.sourceId) continue;
    const at = root.sourceId;

    if (root.type === 'ACCESS_DENIED' && behavior(at) === 'firewall') {
      const ruleId = String(root.data.ruleId);
      const fp = firewallProps(model.components.find((c) => c.id === at)!);
      const rules = ruleId === 'default'
        ? [...fp.rules, { id: `allow-${root.data.protocol}-${root.data.port}`.toLowerCase(), priority: 100, action: 'allow' as const, protocol: root.data.protocol as 'HTTPS', port: root.data.port as number, source: '0.0.0.0/0', description: 'Agregada por recomendación' }]
        : fp.rules.filter((r) => r.id !== ruleId);
      add({
        id: `fw-block:${at}:${ruleId}`,
        problem: `${name(at)} bloquea ${root.data.protocol}:${root.data.port} legítimo`,
        evidence: `Evento ${root.type} (t=${root.t} ms): ${root.message}`,
        evidenceKind: 'simulation',
        componentIds: [at],
        risk: 'Indisponibilidad total del servicio para los usuarios.',
        severity: 'critical',
        solution: ruleId === 'default' ? `Agregar una regla allow explícita para ${root.data.protocol}:${root.data.port}.` : `Eliminar o corregir la regla "${ruleId}".`,
        justification: 'El tráfico HTTPS público es el camino crítico de la solución; la regla que lo deniega tiene mayor prioridad que la que lo permite.',
        benefits: ['Restablece el acceso de usuarios'],
        tradeoffs: ['Si el bloqueo era intencional (mantención), comunicarlo y usar una página de mantenimiento en vez de un RST'],
        complexity: 'low',
        costImpact: 'none',
        priority: 1,
        alternatives: ['Restringir el origen (CIDR) en lugar de bloquear todo', 'Usar ventana de mantención con respuesta 503 controlada'],
        proposal: proposal(`fw-${at}-${ruleId}`, `Corregir reglas de ${name(at)}`, 'Quita la regla que deniega el tráfico legítimo.', [
          { op: 'update_component', componentId: at, patch: { props: { rules } } }
        ])
      });
    }

    if (root.type === 'PACKET_DROPPED' && behavior(at) === 'datastore') {
      const callerId = String(root.data.callerId);
      const ds = datastoreProps(model.components.find((c) => c.id === at)!);
      const conns = model.connections.filter((k) => k.targetId === at);
      const inbound = [
        ...ds.securityGroup.inbound.filter((r) => conns.every((k) => !(r.sourceId === k.sourceId))),
        ...conns.map((k) => ({ id: `sg-${k.sourceId}`, protocol: k.protocol, port: k.port, sourceId: k.sourceId }))
      ];
      add({
        id: `sg-drop:${at}`,
        problem: `El Security Group de ${name(at)} no permite ${root.data.protocol}:${root.data.port} desde ${name(callerId)}`,
        evidence: `Evento PACKET_DROPPED (t=${root.t} ms). En un sistema real sólo se observaría un timeout en el llamador.`,
        evidenceKind: 'simulation',
        componentIds: [at, callerId],
        risk: 'La aplicación no puede leer ni escribir datos; los timeouts amplifican la latencia.',
        severity: 'critical',
        solution: `Permitir ${root.data.protocol}:${root.data.port} únicamente desde los componentes que se conectan a ${name(at)}.`,
        justification: 'Mínimo privilegio: abrir el puerto real del motor sólo a los orígenes modelados.',
        benefits: ['Restablece la conectividad', 'Mantiene el principio de mínimo privilegio'],
        tradeoffs: ['Ninguno relevante si el origen se restringe por componente/SG y no por 0.0.0.0/0'],
        complexity: 'low',
        costImpact: 'none',
        priority: 1,
        alternatives: ['Referenciar el Security Group del backend en vez de IPs'],
        proposal: proposal(`sg-${at}`, `Corregir Security Group de ${name(at)}`, 'Reglas inbound derivadas de las conexiones del modelo.', [
          { op: 'update_component', componentId: at, patch: { props: { securityGroup: { enabled: true, inbound } } } }
        ])
      });
    }

    if (root.type === 'ACCESS_DENIED' && behavior(at) === 'datastore') {
      const callerId = String(root.data.callerId);
      const sp = serviceProps(model.components.find((c) => c.id === callerId)!);
      const action = String(root.data.requiredAction);
      add({
        id: `iam:${callerId}:${action}`,
        problem: `${name(callerId)} carece del permiso ${action}`,
        evidence: `Evento ACCESS_DENIED (t=${root.t} ms) en ${name(at)}.`,
        evidenceKind: 'simulation',
        componentIds: [callerId, at],
        risk: 'Funcionalidad caída con errores 500; reintentos inútiles.',
        severity: 'high',
        solution: `Conceder sólo ${action} sobre el recurso ${name(at)} al rol de ${name(callerId)}.`,
        justification: 'La falla es de autorización, no de red: la corrección es de IAM y debe ser de mínimo privilegio (no usar "*").',
        benefits: ['Restablece la operación', 'Auditable'],
        tradeoffs: ['Requiere revisar la política en IaC para evitar drift'],
        complexity: 'low',
        costImpact: 'none',
        priority: 1,
        alternatives: ['Política administrada con condiciones por recurso'],
        proposal: proposal(`iam-${callerId}`, `Conceder ${action} a ${name(callerId)}`, 'Permiso mínimo requerido por el acceso modelado.', [
          { op: 'update_component', componentId: callerId, patch: { props: { iamPermissions: [...new Set([...sp.iamPermissions, action])] } } }
        ])
      });
    }

    if ((root.type === 'SERVICE_UNAVAILABLE' || root.type === 'CIRCUIT_BREAKER_REJECTED') && behavior(at) === 'datastore') {
      const ds = datastoreProps(model.components.find((c) => c.id === at)!);
      const callers = model.connections.filter((k) => k.targetId === at).map((k) => k.sourceId);
      if (!ds.multiAz) {
        add({
          id: `multiaz:${at}`,
          problem: `${name(at)} es un punto único de falla`,
          evidence: `Evento SERVICE_UNAVAILABLE (t=${root.t} ms): sin standby, todas las solicitudes fallan mientras la instancia esté caída.`,
          evidenceKind: 'simulation',
          componentIds: [at],
          risk: 'Indisponibilidad total ante la caída de una instancia o zona.',
          severity: 'high',
          solution: 'Habilitar despliegue Multi-AZ con standby síncrona y failover automático.',
          justification: 'Principio de confiabilidad (Well-Architected): eliminar puntos únicos de falla en la capa de datos.',
          benefits: ['Recuperación automática tras el failover', 'Mantenimiento con menor impacto'],
          tradeoffs: ['Durante el failover (estimado decenas de segundos) las solicitudes siguen fallando', 'Latencia de escritura levemente mayor'],
          complexity: 'low',
          costImpact: 'high',
          priority: 1,
          alternatives: ['Réplica de lectura con promoción manual (más barata, RTO mayor)', 'Motor distribuido gestionado (Aurora/Cloud Spanner)'],
          proposal: proposal(`multiaz-${at}`, `Habilitar Multi-AZ en ${name(at)}`, 'Elimina el punto único de falla.', [
            { op: 'update_component', componentId: at, patch: { props: { multiAz: true } } }
          ])
        });
      }
      const noCb = callers.filter((id) => !serviceProps(model.components.find((c) => c.id === id)!).circuitBreaker.enabled);
      if (noCb.length) {
        add({
          id: `cb:${at}`,
          problem: `Los llamadores de ${name(at)} reintentan sin circuit breaker`,
          evidence: `Cada solicitud consume timeout × intentos antes de fallar (ver eventos RETRY_STARTED / CONNECTION_TIMEOUT).`,
          evidenceKind: 'simulation',
          componentIds: noCb,
          risk: 'Fallas en cascada: hilos y conexiones bloqueados esperando, latencia alta para el usuario.',
          severity: 'medium',
          solution: 'Habilitar circuit breaker (umbral 3, reset 15 s) en los servicios que llaman a la base de datos.',
          justification: 'Fallar rápido protege los recursos del servicio y mejora la experiencia ante dependencias caídas.',
          benefits: ['Latencia de error acotada', 'Menor presión sobre la dependencia durante su recuperación'],
          tradeoffs: ['Durante el estado abierto se rechazan solicitudes aunque la dependencia ya se haya recuperado (hasta el reset)'],
          complexity: 'medium',
          costImpact: 'none',
          priority: 2,
          alternatives: ['Bulkheads', 'Respuestas degradadas desde caché'],
          proposal: proposal(`cb-${at}`, 'Habilitar circuit breaker en backends', 'Fail-fast ante dependencia caída.', noCb.map((id) => ({
            op: 'update_component' as const,
            componentId: id,
            patch: { props: { circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeoutMs: 15000 } } }
          })))
        });
      }
    }

    if (root.type === 'SERVICE_UNAVAILABLE' && behavior(at) === 'dns') {
      add({
        id: `dns:${at}`,
        problem: 'La resolución DNS es un punto único de falla',
        evidence: `Evento ${root.type} (t=${root.t} ms).`,
        evidenceKind: 'simulation',
        componentIds: [at],
        risk: 'La aplicación sana es inalcanzable.',
        severity: 'high',
        solution: 'Usar un DNS gestionado con SLA alto y servidores autoritativos redundantes.',
        justification: 'El DNS precede a toda la cadena: su falla anula cualquier redundancia aguas abajo.',
        benefits: ['Mayor disponibilidad percibida'],
        tradeoffs: ['Dependencia de proveedor'],
        complexity: 'low',
        costImpact: 'low',
        priority: 2,
        alternatives: ['DNS secundario de otro proveedor']
      });
    }

    if (root.type === 'SERVICE_UNAVAILABLE' && behavior(at) === 'service') {
      const lb = model.connections.find((k) => k.targetId === at && behavior(k.sourceId) === 'load_balancer')?.sourceId;
      if (lb && !lbProps(model.components.find((c) => c.id === lb)!).healthChecks) {
        add({
          id: `hc:${lb}`,
          problem: `${name(lb)} enruta a instancias caídas`,
          evidence: `Evento ${root.type} en ${name(at)} y 504 en el balanceador.`,
          evidenceKind: 'simulation',
          componentIds: [lb, at],
          risk: 'Errores 504 intermitentes aunque existan instancias sanas.',
          severity: 'high',
          solution: 'Habilitar health checks en el balanceador.',
          justification: 'Permite excluir destinos no saludables antes de enrutar.',
          benefits: ['Aprovecha la redundancia existente'],
          tradeoffs: ['Tráfico de health check mínimo'],
          complexity: 'low',
          costImpact: 'none',
          priority: 1,
          alternatives: [],
          proposal: proposal(`hc-${lb}`, `Habilitar health checks en ${name(lb)}`, 'Excluir destinos caídos.', [
            { op: 'update_component', componentId: lb, patch: { props: { healthChecks: true } } }
          ])
        });
      }
    }

    if (root.type === 'AUTHENTICATION_FAILED') {
      add({
        id: `auth:${at}`,
        problem: 'El cliente envía credenciales inválidas',
        evidence: `Evento AUTHENTICATION_FAILED (t=${root.t} ms).`,
        evidenceKind: 'simulation',
        componentIds: [at],
        risk: 'Bajo para la arquitectura: el gateway corta correctamente en el borde.',
        severity: 'low',
        solution: 'Verificar el flujo OAuth2/OIDC del cliente (renovación de tokens).',
        justification: 'La arquitectura se comporta como se espera; el problema es del cliente.',
        benefits: ['Sin cómputo desperdiciado aguas abajo'],
        tradeoffs: [],
        complexity: 'low',
        costImpact: 'none',
        priority: 3,
        alternatives: []
      });
    }

    if (root.type === 'ERROR_RETURNED' && root.data.httpStatus === 429) {
      add({
        id: `throttle:${at}`,
        problem: `${name(at)} aplica throttling (429)`,
        evidence: `Evento ERROR_RETURNED 429 (t=${root.t} ms).`,
        evidenceKind: 'simulation',
        componentIds: [at],
        risk: 'Rechazo de solicitudes en picos de tráfico.',
        severity: 'medium',
        solution: 'Revisar cuotas por cliente, aplicar reintentos con backoff+jitter en el cliente y caché de respuestas.',
        justification: 'El 429 protege el backend; la capacidad debe dimensionarse con datos reales de carga.',
        benefits: ['Mayor tasa de éxito en picos'],
        tradeoffs: ['Aumentar cuotas puede trasladar la presión al backend'],
        complexity: 'low',
        costImpact: 'low',
        priority: 2,
        alternatives: ['Colas para suavizar picos']
      });
    }
  }
  return [...recs.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
