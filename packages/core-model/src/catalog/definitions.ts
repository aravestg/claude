/**
 * Catálogo extensible de componentes. Cada recurso se construye a partir de una definición
 * declarativa (no hay lógica rígida por servicio): el simulador usa `behavior`, el motor 3D usa
 * `shape` y `layer`, el editor usa `inbound`/`outboundProtocols`/`defaultProps`.
 */
import type { BehaviorKind, ComponentCategory, Layer, PortSpec, Protocol, Provider, ShapeKind } from '../types';

export interface LearnContent {
  what: string;
  when: string;
  avoid: string;
  communicates: string;
  needs: string;
  alternatives: string[];
  costs: string;
  risks: string[];
  bestPractices: string[];
  basic: string;
  advanced: string;
}

export interface ComponentDefinition {
  type: string;
  label: string;
  category: ComponentCategory;
  layer: Layer;
  provider: Provider;
  technology: string;
  behavior: BehaviorKind;
  shape: ShapeKind;
  description: string;
  /** Puertos/protocolos en los que el componente acepta conexiones entrantes. */
  inbound: PortSpec[];
  /** Protocolos que puede iniciar como cliente. */
  outboundProtocols: Protocol[];
  defaultProps: Record<string, unknown>;
  equivalents: Partial<Record<Provider, string>>;
  learn: LearnContent;
}

const noopSg = { enabled: false, inbound: [] as unknown[] };

export const DEFINITIONS: ComponentDefinition[] = [
  {
    type: 'client.browser',
    label: 'Usuario (navegador)',
    category: 'client',
    layer: 'application',
    provider: 'generic',
    technology: 'Web browser',
    behavior: 'client',
    shape: 'device',
    description: 'Cliente que origina solicitudes HTTPS hacia la solución.',
    inbound: [],
    outboundProtocols: ['HTTPS', 'HTTP', 'DNS'],
    defaultProps: { targetHost: 'app.example.com', sourceIp: '203.0.113.10', timeoutMs: 10000 },
    equivalents: {},
    learn: {
      what: 'El dispositivo o navegador del usuario final.',
      when: 'Siempre que la solución sea consumida por personas a través de Internet.',
      avoid: 'No aplica.',
      communicates: 'Resuelve el nombre por DNS (UDP/53) y abre una conexión TCP+TLS al puerto 443 del destino.',
      needs: 'Un nombre DNS resoluble y una ruta de red abierta hasta el punto de entrada.',
      alternatives: ['Aplicación móvil', 'Cliente máquina-a-máquina'],
      costs: 'Sin costo de infraestructura propio.',
      risks: ['Redes poco confiables', 'Timeouts del lado cliente'],
      bestPractices: ['Usar HTTPS siempre', 'Definir timeouts y reintentos idempotentes'],
      basic: 'Es quien pide algo a la aplicación, por ejemplo al abrir una página.',
      advanced: 'Inicia la secuencia DNS → TCP SYN → TLS handshake → solicitud HTTP. Su timeout acota la latencia total percibida.'
    }
  },
  {
    type: 'network.dns',
    label: 'DNS',
    category: 'network',
    layer: 'network',
    provider: 'generic',
    technology: 'DNS resolver / zona autoritativa',
    behavior: 'dns',
    shape: 'dns',
    description: 'Resuelve nombres de host a destinos de red.',
    inbound: [{ protocol: 'DNS', port: 53 }],
    outboundProtocols: [],
    defaultProps: { records: [], resolveMs: 12 },
    equivalents: { aws: 'Route 53', azure: 'Azure DNS', gcp: 'Cloud DNS', onprem: 'BIND / AD DNS' },
    learn: {
      what: 'Servicio que traduce nombres (app.example.com) a direcciones.',
      when: 'Siempre que se exponga un servicio por nombre.',
      avoid: 'No acoplar clientes a IPs fijas.',
      communicates: 'UDP/TCP 53. El cliente pregunta y recibe un registro A/AAAA/ALIAS.',
      needs: 'Registros correctos y TTL razonables.',
      alternatives: ['Route 53', 'Azure DNS', 'Cloud DNS'],
      costs: 'Bajo: por zona alojada y por millón de consultas.',
      risks: ['Registros erróneos', 'TTL altos que retrasan cambios', 'Indisponibilidad del proveedor'],
      bestPractices: ['Usar alias hacia balanceadores', 'Health checks y failover DNS para multi-región'],
      basic: 'Es la "guía telefónica" de Internet.',
      advanced: 'Si la resolución falla el cliente nunca llega a abrir TCP: la falla es previa a la red de la aplicación.'
    }
  },
  {
    type: 'network.internet',
    label: 'Internet',
    category: 'network',
    layer: 'network',
    provider: 'generic',
    technology: 'Red pública',
    behavior: 'transit',
    shape: 'globe',
    description: 'Red pública de tránsito entre el cliente y el borde de la solución.',
    inbound: [
      { protocol: 'HTTPS', port: 443 },
      { protocol: 'HTTP', port: 80 }
    ],
    outboundProtocols: ['HTTPS', 'HTTP'],
    defaultProps: {},
    equivalents: {},
    learn: {
      what: 'La red pública.',
      when: 'Cuando la solución se expone a usuarios externos.',
      avoid: 'Exponer directamente bases de datos o servicios internos.',
      communicates: 'Transporta paquetes IP entre el cliente y el borde (firewall/WAF/balanceador).',
      needs: 'Un punto de entrada público (IP pública / Internet Gateway).',
      alternatives: ['VPN', 'Enlace dedicado (Direct Connect / ExpressRoute)'],
      costs: 'Transferencia de datos de salida.',
      risks: ['Ataques externos', 'Latencia variable'],
      bestPractices: ['Minimizar superficie expuesta', 'TLS extremo a extremo'],
      basic: 'Es el camino público por el que viajan las solicitudes.',
      advanced: 'Modelado como tránsito sin estado: no toma decisiones, solo añade latencia estimada.'
    }
  },
  {
    type: 'security.firewall',
    label: 'Firewall',
    category: 'security',
    layer: 'security',
    provider: 'generic',
    technology: 'Firewall stateful L4',
    behavior: 'firewall',
    shape: 'wall',
    description: 'Evalúa reglas por protocolo, puerto y origen. Stateful: valida el inicio de la conexión.',
    inbound: [
      { protocol: 'HTTPS', port: 443 },
      { protocol: 'HTTP', port: 80 }
    ],
    outboundProtocols: ['HTTPS', 'HTTP'],
    defaultProps: {
      defaultAction: 'deny',
      rejectMode: 'reject',
      inspectMs: 1,
      rules: [{ id: 'allow-https', priority: 100, action: 'allow', protocol: 'HTTPS', port: 443, source: '0.0.0.0/0', description: 'HTTPS público' }]
    },
    equivalents: { aws: 'AWS Network Firewall / NACL', azure: 'Azure Firewall', gcp: 'Cloud NGFW', onprem: 'Palo Alto / Fortinet' },
    learn: {
      what: 'Control de red que permite o bloquea tráfico según reglas.',
      when: 'En todo perímetro entre zonas de distinta confianza.',
      avoid: 'Reglas "allow any" o sin documentar.',
      communicates: 'Inspecciona el SYN inicial; si la regla permite, la conexión queda registrada (stateful) y las respuestas vuelven sin reevaluar.',
      needs: 'Reglas ordenadas por prioridad y una acción por defecto.',
      alternatives: ['Security Groups', 'NACL', 'WAF (capa 7)'],
      costs: 'Por hora de endpoint y por GB procesado en servicios gestionados.',
      risks: ['Reglas demasiado permisivas', 'Bloqueos accidentales de puertos legítimos'],
      bestPractices: ['Deny por defecto', 'Mínimo privilegio', 'Revisión periódica de reglas'],
      basic: 'Es un guardia que deja pasar o detiene el tráfico según una lista de reglas.',
      advanced: 'Primera regla coincidente por prioridad ascendente gana. reject envía RST (refused); drop descarta en silencio y el cliente sólo observa timeout.'
    }
  },
  {
    type: 'network.load_balancer',
    label: 'Load Balancer',
    category: 'network',
    layer: 'network',
    provider: 'generic',
    technology: 'Balanceador L7 (HTTPS)',
    behavior: 'load_balancer',
    shape: 'distributor',
    description: 'Termina TLS y distribuye solicitudes entre destinos saludables.',
    inbound: [
      { protocol: 'HTTPS', port: 443 },
      { protocol: 'HTTP', port: 80 }
    ],
    outboundProtocols: ['HTTP', 'HTTPS'],
    defaultProps: { algorithm: 'round_robin', healthChecks: true, processingMs: 2, targetTimeoutMs: 30000 },
    equivalents: { aws: 'Application Load Balancer', azure: 'Application Gateway', gcp: 'Cloud Load Balancing', onprem: 'F5 / HAProxy' },
    learn: {
      what: 'Distribuye conexiones entre varias instancias.',
      when: 'Cuando hay más de una instancia o se necesita terminar TLS de forma centralizada.',
      avoid: 'Con una sola instancia sin plan de crecimiento puede ser complejidad innecesaria.',
      communicates: 'Recibe HTTPS:443, termina TLS y reenvía HTTP a los destinos registrados.',
      needs: 'Destinos registrados y health checks.',
      alternatives: ['ALB', 'NLB', 'Application Gateway', 'HAProxy'],
      costs: 'Por hora y por unidad de capacidad (LCU).',
      risks: ['Health checks mal configurados', 'Destinos en una sola zona'],
      bestPractices: ['Destinos en al menos dos zonas', 'Health checks a un endpoint ligero'],
      basic: 'Reparte el trabajo entre varios servidores.',
      advanced: 'Con health checks activos excluye destinos caídos antes de enrutar; sin ellos enruta a ciegas y la falla aparece como 504.'
    }
  },
  {
    type: 'integration.api_gateway',
    label: 'API Gateway',
    category: 'integration',
    layer: 'integration',
    provider: 'generic',
    technology: 'API Gateway gestionado',
    behavior: 'api_gateway',
    shape: 'gateway',
    description: 'Punto de entrada de APIs con autenticación, throttling y enrutamiento.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: ['HTTPS', 'HTTP'],
    defaultProps: { requireAuth: true, processingMs: 5, integrationTimeoutMs: 29000 },
    equivalents: { aws: 'Amazon API Gateway', azure: 'API Management', gcp: 'API Gateway / Apigee', onprem: 'Kong' },
    learn: {
      what: 'Fachada que expone APIs y aplica políticas transversales.',
      when: 'APIs públicas, serverless, necesidad de autenticación/throttling centralizado.',
      avoid: 'Encadenar varios gateways sin necesidad.',
      communicates: 'HTTPS:443 hacia adentro; invoca la integración (función o servicio) por HTTPS.',
      needs: 'Autorizador configurado y una integración destino.',
      alternatives: ['ALB + middleware', 'API Management', 'Kong'],
      costs: 'Por millón de solicitudes.',
      risks: ['Límites de throttling (429)', 'Timeouts de integración'],
      bestPractices: ['Validar tokens en el borde', 'Definir cuotas por cliente'],
      basic: 'Es la recepción de la API: verifica quién eres y te deriva al servicio correcto.',
      advanced: 'Rechaza con 401 antes de invocar la integración si el token falta o es inválido, ahorrando cómputo aguas abajo.'
    }
  },
  {
    type: 'compute.app_server',
    label: 'Backend (servidor de aplicación)',
    category: 'compute',
    layer: 'application',
    provider: 'generic',
    technology: 'Node.js API en VM/contenedor',
    behavior: 'service',
    shape: 'server',
    description: 'Servicio de aplicación que procesa solicitudes y consulta dependencias.',
    inbound: [
      { protocol: 'HTTP', port: 8080 },
      { protocol: 'HTTPS', port: 8443 }
    ],
    outboundProtocols: ['JDBC', 'HTTPS', 'HTTP', 'TCP'],
    defaultProps: {
      runtime: 'Node.js 22',
      processingMs: 15,
      timeoutMs: 2000,
      retries: 2,
      retryBackoffMs: 200,
      circuitBreaker: { enabled: false, failureThreshold: 3, resetTimeoutMs: 15000 },
      poolSize: 10,
      iamPermissions: []
    },
    equivalents: { aws: 'EC2 / ECS Fargate', azure: 'App Service / Container Apps', gcp: 'Compute Engine / Cloud Run', onprem: 'VM / servidor físico' },
    learn: {
      what: 'Proceso que ejecuta la lógica de negocio.',
      when: 'Cargas sostenidas, lógica compleja, conexiones persistentes a bases de datos.',
      avoid: 'Cargas esporádicas donde serverless sería más simple y barato.',
      communicates: 'Recibe HTTP del balanceador; usa un pool de conexiones JDBC hacia la base de datos.',
      needs: 'Red hacia sus dependencias, timeouts, reintentos y observabilidad.',
      alternatives: ['ECS Fargate', 'Lambda', 'Cloud Run'],
      costs: 'Por hora de instancia aunque esté ociosa.',
      risks: ['Reintentos sin backoff amplifican fallas', 'Agotamiento del pool'],
      bestPractices: ['Timeouts explícitos', 'Reintentos con backoff', 'Circuit breaker hacia dependencias'],
      basic: 'Es el cerebro que procesa lo que pide el usuario.',
      advanced: 'Cada reintento consume timeoutMs completo cuando la dependencia no responde; sin circuit breaker la latencia total crece linealmente con los reintentos.'
    }
  },
  {
    type: 'compute.function',
    label: 'Función serverless',
    category: 'compute',
    layer: 'application',
    provider: 'generic',
    technology: 'Función gestionada (FaaS)',
    behavior: 'service',
    shape: 'function',
    description: 'Función efímera invocada por eventos o por un API Gateway.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: ['HTTPS', 'JDBC', 'TCP'],
    defaultProps: {
      runtime: 'Node.js 22',
      processingMs: 25,
      timeoutMs: 3000,
      retries: 1,
      retryBackoffMs: 100,
      circuitBreaker: { enabled: false, failureThreshold: 3, resetTimeoutMs: 15000 },
      poolSize: 1,
      iamPermissions: []
    },
    equivalents: { aws: 'AWS Lambda', azure: 'Azure Functions', gcp: 'Cloud Run functions' },
    learn: {
      what: 'Código que se ejecuta bajo demanda sin gestionar servidores.',
      when: 'Tráfico variable o esporádico, integraciones por eventos.',
      avoid: 'Procesos de larga duración o con conexiones persistentes intensivas a BD relacional.',
      communicates: 'Invocada por HTTPS (vía gateway); accede a servicios gestionados con credenciales IAM del rol de ejecución.',
      needs: 'Rol IAM con mínimo privilegio y, si accede a una VPC, configuración de red.',
      alternatives: ['Contenedores (Fargate/Cloud Run)', 'VM'],
      costs: 'Por invocación y GB-segundo.',
      risks: ['Cold starts', 'Permisos IAM insuficientes', 'Límites de concurrencia'],
      bestPractices: ['Un rol por función', 'Timeouts menores que el del gateway'],
      basic: 'Un pequeño programa que se enciende sólo cuando se necesita.',
      advanced: 'Las llamadas a servicios gestionados se autorizan con IAM: un permiso ausente produce AccessDenied (403), no un error de red.'
    }
  },
  {
    type: 'data.postgresql',
    label: 'Base de datos PostgreSQL',
    category: 'data',
    layer: 'data',
    provider: 'generic',
    technology: 'PostgreSQL 16',
    behavior: 'datastore',
    shape: 'database',
    description: 'Base de datos relacional transaccional.',
    inbound: [{ protocol: 'JDBC', port: 5432 }],
    outboundProtocols: [],
    defaultProps: {
      engine: 'PostgreSQL 16',
      queryMs: 8,
      multiAz: false,
      failoverMs: 35000,
      securityGroup: { enabled: true, inbound: [] },
      requiresIam: false,
      requiredAction: ''
    },
    equivalents: { aws: 'Amazon RDS / Aurora PostgreSQL', azure: 'Azure Database for PostgreSQL', gcp: 'Cloud SQL', onprem: 'PostgreSQL en VM' },
    learn: {
      what: 'Almacén relacional con transacciones ACID.',
      when: 'Datos estructurados con integridad referencial y consultas complejas.',
      avoid: 'Patrones de acceso clave-valor masivos sin relaciones.',
      communicates: 'Protocolo de PostgreSQL sobre TCP/5432 (JDBC desde Java/Node drivers equivalentes).',
      needs: 'Security Group que permita 5432 sólo desde el backend, backups y monitoreo.',
      alternatives: ['MySQL', 'SQL Server', 'Oracle', 'Aurora'],
      costs: 'Por hora de instancia + almacenamiento + IOPS. Multi-AZ ≈ duplica el costo de cómputo.',
      risks: ['Instancia única = punto único de falla', 'Exposición pública', 'Bloqueos transaccionales'],
      bestPractices: ['Multi-AZ en producción', 'Sin acceso público', 'Pool de conexiones en la aplicación'],
      basic: 'Es donde se guardan los datos de forma ordenada.',
      advanced: 'Si la instancia cae y no hay Multi-AZ, cada consulta espera el timeout del cliente. Con Multi-AZ el failover a la standby demora típicamente decenas de segundos (estimación).'
    }
  },
  {
    type: 'data.nosql',
    label: 'Base de datos NoSQL (clave-valor)',
    category: 'data',
    layer: 'data',
    provider: 'generic',
    technology: 'Clave-valor gestionado',
    behavior: 'datastore',
    shape: 'nosql',
    description: 'Almacén clave-valor gestionado, accedido por API HTTPS autorizada con IAM.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: {
      engine: 'Key-value',
      queryMs: 5,
      multiAz: true,
      failoverMs: 0,
      securityGroup: noopSg,
      requiresIam: true,
      requiredAction: 'dynamodb:GetItem'
    },
    equivalents: { aws: 'Amazon DynamoDB', azure: 'Cosmos DB', gcp: 'Firestore / Bigtable' },
    learn: {
      what: 'Base de datos gestionada para accesos por clave con latencia baja.',
      when: 'Patrones de acceso conocidos, escalado elástico, serverless.',
      avoid: 'Consultas ad-hoc complejas o joins.',
      communicates: 'API HTTPS firmada (SigV4 en AWS); cada llamada se autoriza con IAM.',
      needs: 'Permisos IAM explícitos por acción y tabla.',
      alternatives: ['DynamoDB', 'Cosmos DB', 'MongoDB'],
      costs: 'Por solicitud (on-demand) o capacidad aprovisionada.',
      risks: ['Diseño de claves deficiente (hot partitions)', 'Permisos IAM demasiado amplios'],
      bestPractices: ['Permisos por acción y recurso', 'Diseñar a partir de patrones de acceso'],
      basic: 'Guarda datos como un diccionario gigante: clave → valor.',
      advanced: 'Es multi-AZ por diseño en servicios gestionados; las fallas típicas son de autorización (403) o throttling (400/429), no de red.'
    }
  }
];
