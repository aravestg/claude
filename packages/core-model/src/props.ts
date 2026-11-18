import { clone } from './clone';
import { getDefinition } from './catalog';
import type {
  ApiGatewayProps,
  ClientProps,
  ComponentInstance,
  DatastoreProps,
  DnsProps,
  FirewallProps,
  LoadBalancerProps,
  ServiceProps
} from './types';

/** Propiedades efectivas = defaults del catálogo + overrides de la instancia (merge superficial). */
export function effectiveProps<T>(c: ComponentInstance): T {
  const def = getDefinition(c.type);
  return { ...clone(def.defaultProps), ...clone(c.props) } as T;
}

export const clientProps = (c: ComponentInstance) => effectiveProps<ClientProps>(c);
export const dnsProps = (c: ComponentInstance) => effectiveProps<DnsProps>(c);
export const firewallProps = (c: ComponentInstance) => effectiveProps<FirewallProps>(c);
export const lbProps = (c: ComponentInstance) => effectiveProps<LoadBalancerProps>(c);
export const gatewayProps = (c: ComponentInstance) => effectiveProps<ApiGatewayProps>(c);
export const serviceProps = (c: ComponentInstance) => effectiveProps<ServiceProps>(c);
export const datastoreProps = (c: ComponentInstance) => effectiveProps<DatastoreProps>(c);
