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
    equivalents: { aws: 'Amazon API Gateway', azure: 'API Management', gcp: 'API Gateway / Apigee', onprem: 'Kong / MuleSoft Anypoint' },
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
  },
  {
    type: 'data.object_storage',
    label: 'Almacenamiento de objetos',
    category: 'data',
    layer: 'data',
    provider: 'generic',
    technology: 'Object storage (S3 compatible)',
    behavior: 'datastore',
    shape: 'bucket',
    description: 'Almacenamiento de archivos y objetos accedido por API HTTPS.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: {
      engine: 'Object storage',
      queryMs: 20,
      multiAz: true,
      failoverMs: 0,
      securityGroup: noopSg,
      requiresIam: false,
      requiredAction: 's3:GetObject'
    },
    equivalents: { aws: 'Amazon S3', azure: 'Blob Storage', gcp: 'Cloud Storage', onprem: 'MinIO' },
    learn: {
      what: 'Almacén de archivos (objetos) con alta durabilidad.',
      when: 'Documentos, imágenes, respaldos, datos estáticos.',
      avoid: 'Datos con actualizaciones parciales frecuentes o consultas transaccionales.',
      communicates: 'API HTTPS (PUT/GET de objetos), firmada con credenciales.',
      needs: 'Política de acceso (bucket policy / IAM) y cifrado.',
      alternatives: ['Amazon S3', 'Azure Blob Storage', 'Google Cloud Storage'],
      costs: 'Por GB almacenado, solicitudes y transferencia de salida.',
      risks: ['Buckets públicos por error', 'Costos de egreso'],
      bestPractices: ['Bloquear acceso público', 'Cifrado por defecto', 'Ciclo de vida de objetos'],
      basic: 'Un gran disco en la nube para guardar archivos.',
      advanced: 'Consistencia fuerte de lectura tras escritura en los servicios modernos; la latencia es mayor que la de una base de datos.'
    }
  },
  {
    type: 'network.vpn',
    label: 'VPN / enlace dedicado',
    category: 'network',
    layer: 'network',
    provider: 'generic',
    technology: 'Site-to-site VPN o enlace privado',
    behavior: 'transit',
    shape: 'tunnel',
    description: 'Conecta la red corporativa con la nube por un túnel cifrado o enlace dedicado.',
    inbound: [{ protocol: 'HTTPS', port: 443 }, { protocol: 'HTTP', port: 80 }, { protocol: 'TCP', port: 443 }, { protocol: 'JDBC', port: 5432 }],
    outboundProtocols: ['HTTPS', 'HTTP', 'TCP', 'JDBC'],
    defaultProps: {},
    equivalents: { aws: 'Site-to-Site VPN / Direct Connect', azure: 'VPN Gateway / ExpressRoute', gcp: 'Cloud VPN / Interconnect', onprem: 'Firewall con IPsec' },
    learn: { what: 'Túnel cifrado o enlace privado entre redes.', when: 'Acceso desde oficinas o datacenter a recursos privados en la nube.', avoid: 'Si el servicio debe ser público en Internet.', communicates: 'Encapsula tráfico IP (IPsec) o usa un circuito dedicado; no termina TLS de la aplicación.', needs: 'Rutas en ambos extremos y reglas de firewall coherentes.', alternatives: ['Direct Connect', 'ExpressRoute', 'Interconnect'], costs: 'Por hora de túnel y por GB transferido; los enlaces dedicados tienen costo de puerto.', risks: ['Túnel único sin redundancia', 'Rutas asimétricas'], bestPractices: ['Dos túneles en zonas distintas', 'Monitorear el estado de BGP'], basic: 'Un pasillo privado entre la oficina y la nube.', advanced: 'Modelado como tránsito: añade latencia, no decide. Su caída se simula con COMPONENT_DOWN.' }
  },
  {
    type: 'network.nat_gateway',
    label: 'NAT Gateway',
    category: 'network',
    layer: 'network',
    provider: 'generic',
    technology: 'NAT administrado (egress)',
    behavior: 'transit',
    shape: 'tunnel',
    description: 'Permite que subredes privadas salgan a Internet sin exponerse.',
    inbound: [{ protocol: 'HTTPS', port: 443 }, { protocol: 'HTTP', port: 80 }, { protocol: 'TCP', port: 443 }, { protocol: 'JDBC', port: 5432 }],
    outboundProtocols: ['HTTPS', 'HTTP', 'TCP', 'JDBC'],
    defaultProps: {},
    equivalents: { aws: 'NAT Gateway', azure: 'NAT Gateway', gcp: 'Cloud NAT' },
    learn: { what: 'Traducción de direcciones para salida a Internet.', when: 'Subredes privadas que necesitan llamar a APIs externas.', avoid: 'Si el servicio externo ofrece PrivateLink/endpoint privado.', communicates: 'Recibe conexiones salientes y las reenvía con su IP pública por el Internet Gateway.', needs: 'Ruta 0.0.0.0/0 desde la subred privada y un Internet Gateway.', alternatives: ['VPC Endpoints', 'Proxy de salida'], costs: 'Por hora y por GB procesado (suele ser un costo relevante).', risks: ['Punto único si está en una sola zona', 'Costo de procesamiento'], bestPractices: ['Un NAT por zona', 'Preferir endpoints privados para servicios AWS'], basic: 'La puerta de salida de una red privada.', advanced: 'Sólo tráfico iniciado desde adentro; no acepta conexiones entrantes.' }
  },
  {
    type: 'network.vpc_endpoint',
    label: 'VPC Endpoint / PrivateLink',
    category: 'network',
    layer: 'network',
    provider: 'generic',
    technology: 'Endpoint privado de servicio',
    behavior: 'transit',
    shape: 'tunnel',
    description: 'Acceso privado a un servicio sin pasar por Internet.',
    inbound: [{ protocol: 'HTTPS', port: 443 }, { protocol: 'HTTP', port: 80 }, { protocol: 'TCP', port: 443 }, { protocol: 'JDBC', port: 5432 }],
    outboundProtocols: ['HTTPS', 'HTTP', 'TCP', 'JDBC'],
    defaultProps: {},
    equivalents: { aws: 'VPC Endpoint / PrivateLink', azure: 'Private Endpoint', gcp: 'Private Service Connect' },
    learn: { what: 'Interfaz privada hacia un servicio gestionado o de un tercero.', when: 'Acceder a Secrets, S3, KMS o a un SaaS sin salir a Internet.', avoid: 'Servicios que no ofrecen endpoint privado.', communicates: 'El cliente resuelve el nombre del servicio a IPs privadas del endpoint; el tráfico sigue siendo HTTPS.', needs: 'DNS privado y Security Group del endpoint.', alternatives: ['NAT Gateway', 'Proxy'], costs: 'Por hora de endpoint y por GB.', risks: ['DNS privado mal configurado', 'Security Group del endpoint restrictivo'], bestPractices: ['Políticas de endpoint de mínimo privilegio'], basic: 'Una entrada privada a un servicio.', advanced: 'Modelado como tránsito que reenvía al servicio que expone.' }
  },
  {
    type: 'security.kms',
    label: 'Gestión de llaves (KMS)',
    category: 'security',
    layer: 'security',
    provider: 'generic',
    technology: 'KMS administrado',
    behavior: 'datastore',
    shape: 'key',
    description: 'Custodia de llaves criptográficas y cifrado de datos.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: { engine: 'API gestionada', queryMs: 15, multiAz: true, failoverMs: 0, securityGroup: noopSg, requiresIam: false, requiredAction: '' },
    equivalents: { aws: 'AWS KMS', azure: 'Key Vault (keys)', gcp: 'Cloud KMS', onprem: 'HSM' },
    learn: { what: 'Servicio que custodia llaves y cifra/descifra.', when: 'Cifrado en reposo y firma.', avoid: 'Gestionar llaves en el código o en archivos.', communicates: 'API HTTPS; los servicios de datos lo usan internamente para cifrar.', needs: 'Políticas de llave de mínimo privilegio.', alternatives: ['Key Vault', 'Cloud KMS', 'HSM'], costs: 'Por llave/mes y por solicitud.', risks: ['Política de llave demasiado amplia', 'Borrado accidental de llaves'], bestPractices: ['Rotación automática', 'Separar llaves por entorno'], basic: 'La caja fuerte de las llaves.', advanced: 'Las relaciones de "cifrado" en un diagrama no son tráfico de red y no se simulan como solicitudes.' }
  },
  {
    type: 'security.secrets',
    label: 'Gestor de secretos',
    category: 'security',
    layer: 'security',
    provider: 'generic',
    technology: 'Secrets Manager',
    behavior: 'datastore',
    shape: 'key',
    description: 'Almacena credenciales y tokens con rotación.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: { engine: 'API gestionada', queryMs: 15, multiAz: true, failoverMs: 0, securityGroup: noopSg, requiresIam: false, requiredAction: '' },
    equivalents: { aws: 'Secrets Manager', azure: 'Key Vault (secrets)', gcp: 'Secret Manager', onprem: 'HashiCorp Vault' },
    learn: { what: 'Almacén seguro de credenciales.', when: 'Contraseñas de BD, tokens de APIs.', avoid: 'Variables de entorno en texto plano o secretos en el repositorio.', communicates: 'API HTTPS (GetSecretValue), idealmente vía endpoint privado.', needs: 'Permisos de lectura por rol y rotación.', alternatives: ['Vault', 'Key Vault'], costs: 'Por secreto/mes y por llamada.', risks: ['Leer el secreto en cada solicitud (latencia y costo)'], bestPractices: ['Caché local con expiración', 'Rotación automática'], basic: 'Una bóveda para contraseñas.', advanced: 'Si no responde, la aplicación no puede autenticarse con sus dependencias.' }
  },
  {
    type: 'security.certificates',
    label: 'Certificados (PKI)',
    category: 'security',
    layer: 'security',
    provider: 'generic',
    technology: 'ACM / CA interna',
    behavior: 'datastore',
    shape: 'key',
    description: 'Emisión y gestión de certificados TLS.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: { engine: 'API gestionada', queryMs: 15, multiAz: true, failoverMs: 0, securityGroup: noopSg, requiresIam: false, requiredAction: '' },
    equivalents: { aws: 'ACM / Private CA', azure: 'Key Vault (certificates)', gcp: 'Certificate Manager', onprem: 'PKI / CA interna' },
    learn: { what: 'Servicio que emite o almacena certificados.', when: 'Terminar TLS en balanceadores y servicios.', avoid: 'Certificados autofirmados en producción.', communicates: 'Se asocia a balanceadores y endpoints; no participa en cada solicitud.', needs: 'Renovación antes del vencimiento y cadena completa.', alternatives: ['ACM', 'Let\'s Encrypt', 'PKI interna'], costs: 'Gratis en ACM para recursos AWS; CA privada tiene costo mensual.', risks: ['Vencimiento no monitoreado', 'Cadena incompleta en clientes'], bestPractices: ['Alertas de vencimiento', 'Automatizar renovación'], basic: 'El que emite las identificaciones de los servidores.', advanced: 'La relación "adjunta certificado" es configuración, no tráfico.' }
  },
  {
    type: 'observability.monitoring',
    label: 'Monitoreo y logs',
    category: 'integration',
    layer: 'integration',
    provider: 'generic',
    technology: 'Logs y métricas gestionados',
    behavior: 'datastore',
    shape: 'chart',
    description: 'Recibe logs y métricas de la aplicación.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: { engine: 'API gestionada', queryMs: 10, multiAz: true, failoverMs: 0, securityGroup: noopSg, requiresIam: false, requiredAction: '' },
    equivalents: { aws: 'CloudWatch', azure: 'Azure Monitor', gcp: 'Cloud Logging / Monitoring', onprem: 'ELK / Prometheus' },
    learn: { what: 'Plataforma de observabilidad.', when: 'Siempre en producción.', avoid: 'Logs sólo en el disco de la instancia.', communicates: 'Los agentes o SDK envían logs y métricas por HTTPS.', needs: 'Retención y alarmas definidas.', alternatives: ['CloudWatch', 'Datadog', 'Prometheus'], costs: 'Por GB ingerido y almacenado.', risks: ['Costos de ingesta descontrolados', 'Falta de alarmas'], bestPractices: ['Logs estructurados', 'Alarmas sobre SLO'], basic: 'El tablero de signos vitales del sistema.', advanced: 'En la simulación, si se cae, las llamadas síncronas a él fallan: conviene enviarle datos de forma asíncrona.' }
  },
  {
    type: 'integration.email',
    label: 'Servicio de email',
    category: 'integration',
    layer: 'integration',
    provider: 'generic',
    technology: 'Envío de correo transaccional',
    behavior: 'datastore',
    shape: 'mail',
    description: 'Envío de correos desde la aplicación.',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: { engine: 'API gestionada', queryMs: 40, multiAz: true, failoverMs: 0, securityGroup: noopSg, requiresIam: false, requiredAction: '' },
    equivalents: { aws: 'Amazon SES', azure: 'Communication Services', gcp: 'SendGrid (Marketplace)', onprem: 'Relay SMTP' },
    learn: { what: 'Servicio de correo saliente.', when: 'Notificaciones, confirmaciones.', avoid: 'Envíos masivos sin control de reputación.', communicates: 'API HTTPS o SMTP con TLS.', needs: 'Dominio verificado (SPF, DKIM, DMARC).', alternatives: ['SES', 'SendGrid'], costs: 'Por cada mil correos.', risks: ['Rebotes que dañan la reputación'], bestPractices: ['Encolar envíos', 'Monitorear rebotes'], basic: 'El cartero de la aplicación.', advanced: 'Mejor invocarlo de forma asíncrona (cola) para no bloquear la respuesta al usuario.' }
  },
  {
    type: 'integration.saas_api',
    label: 'Sistema externo (SaaS / API)',
    category: 'integration',
    layer: 'integration',
    provider: 'generic',
    technology: 'API de terceros',
    behavior: 'datastore',
    shape: 'saas',
    description: 'Servicio externo consumido por API (SaaS, ITSM, RR. HH., identidad…).',
    inbound: [{ protocol: 'HTTPS', port: 443 }],
    outboundProtocols: [],
    defaultProps: { engine: 'API gestionada', queryMs: 120, multiAz: true, failoverMs: 0, securityGroup: noopSg, requiresIam: false, requiredAction: '' },
    equivalents: { aws: 'Servicio externo', azure: 'Servicio externo', gcp: 'Servicio externo', onprem: 'Sistema de terceros' },
    learn: { what: 'Un sistema fuera de su control al que se llama por API.', when: 'Integraciones con SaaS (identidad, RR. HH., tickets, mensajería).', avoid: 'Llamarlo de forma síncrona en el camino crítico sin timeouts.', communicates: 'HTTPS con OAuth 2.0 / API keys, normalmente a través de un gateway o plataforma de integración.', needs: 'Credenciales gestionadas, timeouts, reintentos y límites de tasa.', alternatives: ['Plataforma de integración (MuleSoft, etc.)'], costs: 'Según el contrato del proveedor.', risks: ['Latencia alta y variable', 'Límites de tasa (429)', 'Cambios de API'], bestPractices: ['Timeouts y circuit breaker', 'Aislar detrás de una API de experiencia'], basic: 'Un servicio de otra empresa que la aplicación usa.', advanced: 'Latencia estimada alta (120 ms); su caída se propaga si no hay resiliencia.' }
  }
];
