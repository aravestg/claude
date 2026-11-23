/**
 * Reglas declarativas para mapear figuras de draw.io al catálogo. Se evalúan en orden:
 * primero por estilo (íconos oficiales AWS/Azure/GCP y figuras genéricas), luego por texto.
 * Extensible: `registerDrawioRule` agrega reglas antes de las genéricas.
 */
import type { GroupKind } from '../types';

export interface DrawioRule {
  type: string;
  style?: RegExp;
  label?: RegExp;
  confidence: 'alta' | 'media' | 'baja';
}

const STYLE_RULES: DrawioRule[] = [
  // ---- AWS (mxgraph.aws4) ----
  { type: 'compute.function', style: /aws4\.(lambda|lambda_function)/, confidence: 'alta' },
  { type: 'integration.api_gateway', style: /aws4\.(api_gateway|endpoint)/, confidence: 'alta' },
  { type: 'network.load_balancer', style: /aws4\.(application_load_balancer|network_load_balancer|elastic_load_balancing|classic_load_balancer)/, confidence: 'alta' },
  { type: 'data.nosql', style: /aws4\.(dynamodb|documentdb|elasticache|keyspaces)/, confidence: 'alta' },
  { type: 'data.postgresql', style: /aws4\.(rds|aurora|database|rds_instance|db_instance)/, confidence: 'alta' },
  { type: 'data.object_storage', style: /aws4\.(s3|simple_storage_service|bucket)/, confidence: 'alta' },
  { type: 'network.dns', style: /aws4\.(route_53|hosted_zone)/, confidence: 'alta' },
  { type: 'security.firewall', style: /aws4\.(network_firewall|waf|shield|firewall)/, confidence: 'alta' },
  { type: 'network.internet', style: /aws4\.(internet|internet_gateway|internet_alt|cloudfront)/, confidence: 'media' },
  { type: 'client.browser', style: /aws4\.(user|users|client|mobile_client|traditional_server_client)/, confidence: 'alta' },
  { type: 'compute.app_server', style: /aws4\.(ec2|instance|instances|ecs|fargate|eks|elastic_beanstalk|container|app_runner|lightsail)/, confidence: 'alta' },
  // ---- Azure ----
  { type: 'compute.function', style: /(azure2?\/.*function_apps|mxgraph\.azure\.azure_functions)/, confidence: 'alta' },
  { type: 'integration.api_gateway', style: /(api_management|mxgraph\.azure\.api_management)/, confidence: 'alta' },
  { type: 'network.load_balancer', style: /(azure2?\/.*(load_balancers|application_gateways|front_doors)|mxgraph\.azure\.load_balancer)/, confidence: 'alta' },
  { type: 'data.nosql', style: /(cosmos_db|azure_cosmos|cache_redis)/, confidence: 'alta' },
  { type: 'data.postgresql', style: /(sql_database|azure_database|sql_server|mxgraph\.azure\.sql_database|database_postgresql|database_mysql)/, confidence: 'alta' },
  { type: 'data.object_storage', style: /(storage_accounts|blob|mxgraph\.azure\.storage)/, confidence: 'alta' },
  { type: 'network.dns', style: /(dns_zones|azure_dns)/, confidence: 'alta' },
  { type: 'security.firewall', style: /(azure2?\/.*firewalls|web_application_firewall|network_security_groups)/, confidence: 'alta' },
  { type: 'compute.app_server', style: /(virtual_machine|app_services|container_instances|kubernetes_services|mxgraph\.azure\.(virtual_machine|web_role|worker_role))/, confidence: 'alta' },
  // ---- Google Cloud ----
  { type: 'compute.function', style: /gcp2?\.(cloud_functions|functions)/, confidence: 'alta' },
  { type: 'integration.api_gateway', style: /gcp2?\.(api_gateway|apigee|endpoints)/, confidence: 'alta' },
  { type: 'network.load_balancer', style: /gcp2?\.(cloud_load_balancing|load_balancing)/, confidence: 'alta' },
  { type: 'data.nosql', style: /gcp2?\.(firestore|bigtable|datastore|memorystore)/, confidence: 'alta' },
  { type: 'data.postgresql', style: /gcp2?\.(cloud_sql|spanner|alloydb)/, confidence: 'alta' },
  { type: 'data.object_storage', style: /gcp2?\.(cloud_storage|storage)/, confidence: 'alta' },
  { type: 'network.dns', style: /gcp2?\.(cloud_dns|dns)/, confidence: 'alta' },
  { type: 'security.firewall', style: /gcp2?\.(cloud_armor|firewall)/, confidence: 'alta' },
  { type: 'compute.app_server', style: /gcp2?\.(compute_engine|cloud_run|app_engine|kubernetes_engine|gke)/, confidence: 'alta' },
  // ---- Genéricas / redes ----
  { type: 'security.firewall', style: /(networks\.firewall|cisco\.(security|firewall)|mxgraph\.cisco\.firewalls)/, confidence: 'alta' },
  { type: 'network.load_balancer', style: /(networks\.load_balancer|cisco.*load_balancer)/, confidence: 'alta' },
  { type: 'network.internet', style: /(shape=cloud|networks\.cloud|ellipse;shape=cloud|mxgraph\.basic\.cloud)/, confidence: 'media' },
  { type: 'client.browser', style: /(umlactor|basic\.person|networks\.(pc|laptop|mobile|user_male|users)|mockup\.|shape=actor)/, confidence: 'media' },
  { type: 'data.postgresql', style: /(cylinder|datastore|database|networks\.storage)/, confidence: 'media' },
  { type: 'compute.app_server', style: /(networks\.(server|web_server|mainframe|virtual_server)|cisco\.servers)/, confidence: 'media' }
];

const LABEL_RULES: DrawioRule[] = [
  { type: 'integration.api_gateway', label: /\b(api ?gateway|apigee|api management|apim|kong)\b/, confidence: 'media' },
  { type: 'network.load_balancer', label: /\b(alb|elb|nlb|load ?balancer|balanceador|haproxy|f5|nginx lb)\b/, confidence: 'media' },
  { type: 'security.firewall', label: /\b(firewall|waf|cortafuegos|palo ?alto|fortinet)\b/, confidence: 'media' },
  { type: 'network.dns', label: /\b(dns|route ?53)\b/, confidence: 'media' },
  { type: 'network.internet', label: /\b(internet|wan|red p[uú]blica)\b/, confidence: 'media' },
  { type: 'compute.function', label: /\b(lambda|functions?|funci[oó]n|serverless)\b/, confidence: 'media' },
  { type: 'data.nosql', label: /\b(dynamo(db)?|nosql|mongo(db)?|cosmos|redis|cassandra|firestore)\b/, confidence: 'media' },
  { type: 'data.object_storage', label: /\b(s3|bucket|blob|object storage|almacenamiento de (objetos|archivos))\b/, confidence: 'media' },
  { type: 'data.postgresql', label: /\b(db|bd|database|base de datos|rds|aurora|postgres(ql)?|mysql|oracle|sql ?server|informix|mariadb)\b/, confidence: 'media' },
  { type: 'client.browser', label: /\b(users?|usuarios?|clientes?|clients?|browser|navegador|web app|mobile|m[oó]vil)\b/, confidence: 'media' },
  { type: 'compute.app_server', label: /\b(server|servidor|ec2|vm|backend|api|service|servicio|app|ecs|container|contenedor|kubernetes|k8s|microservicio)\b/, confidence: 'baja' }
];

const extra: DrawioRule[] = [];
export function registerDrawioRule(rule: DrawioRule): void {
  extra.push(rule);
}

export function classify(style: string, label: string): { type: string; confidence: DrawioRule['confidence']; by: 'estilo' | 'texto' } | undefined {
  const st = style.toLowerCase();
  const lb = label.toLowerCase();
  for (const r of [...extra, ...STYLE_RULES]) if (r.style?.test(st) || (r.label && r.label.test(lb) && !r.style)) return { type: r.type, confidence: r.confidence, by: r.style ? 'estilo' : 'texto' };
  for (const r of LABEL_RULES) if (r.label!.test(lb)) return { type: r.type, confidence: r.confidence, by: 'texto' };
  return undefined;
}

export function groupKindOf(style: string, label: string): GroupKind | undefined {
  const t = `${style} ${label}`.toLowerCase();
  if (/(group_vpc|virtual_networks|\bvpc\b|\bvnet\b|virtual network)/.test(t)) return 'vpc';
  if (/(subnet|subred)/.test(t)) return 'subnet';
  if (/(availability_zone|availability zone|\baz\b|zona de disponibilidad)/.test(t)) return 'availability_zone';
  if (/(group_region|\bregion\b|regi[oó]n)/.test(t)) return 'region';
  if (/(corporate_data_center|on_premise|datacenter|data center|on-?prem)/.test(t)) return 'datacenter';
  if (/(group_aws_cloud|aws cloud|azure|google cloud|\bgcp\b|\bcloud\b)/.test(t)) return 'region';
  if (/(group_security_group|security group)/.test(t)) return 'subnet';
  return undefined;
}

/** Protocolo/puerto indicados en el texto de una flecha. */
export function protocolFromLabel(label: string): { protocol?: 'HTTPS' | 'HTTP' | 'JDBC' | 'DNS' | 'TCP' | 'SSH' | 'SFTP'; port?: number } {
  const l = label.toLowerCase();
  const portM = l.match(/(?::|port\s*|puerto\s*)(\d{2,5})\b/) ?? l.match(/\b(\d{2,5})\b/);
  const port = portM ? Number(portM[1]) : undefined;
  const validPort = port && port > 0 && port < 65536 ? port : undefined;
  if (/https|tls|ssl|443/.test(l)) return { protocol: 'HTTPS', port: validPort ?? 443 };
  if (/\bhttp\b|rest|graphql|grpc/.test(l)) return { protocol: 'HTTP', ...(validPort ? { port: validPort } : {}) };
  if (/jdbc|odbc|sql|5432|3306|1521|1433|postgres|mysql|oracle/.test(l)) return { protocol: 'JDBC', ...(validPort ? { port: validPort } : {}) };
  if (/\bdns\b|\b53\b/.test(l)) return { protocol: 'DNS', port: 53 };
  if (/\bsftp\b/.test(l)) return { protocol: 'SFTP', port: validPort ?? 22 };
  if (/\bssh\b/.test(l)) return { protocol: 'SSH', port: validPort ?? 22 };
  if (/\btcp\b/.test(l)) return { protocol: 'TCP', ...(validPort ? { port: validPort } : {}) };
  return validPort ? { port: validPort } : {};
}
