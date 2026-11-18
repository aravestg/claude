import { describe, expect, it } from 'vitest';
import { getTemplate } from '@asa/core-model';
import { cidrContains, evaluateFirewall, findPath, matchSecurityGroup, protocolMatches } from '../src';

describe('red', () => {
  it('CIDR', () => {
    expect(cidrContains('0.0.0.0/0', '8.8.8.8')).toBe(true);
    expect(cidrContains('10.0.0.0/16', '10.0.255.1')).toBe(true);
    expect(cidrContains('10.0.0.0/16', '10.1.0.1')).toBe(false);
    expect(cidrContains('203.0.113.10/32', '203.0.113.10')).toBe(true);
    expect(cidrContains('bad', '1.1.1.1')).toBe(false);
    expect(cidrContains('10.0.0.0/40', '10.0.0.1')).toBe(false);
  });
  it('TCP cubre protocolos sobre TCP', () => {
    expect(protocolMatches('TCP', 'JDBC')).toBe(true);
    expect(protocolMatches('TCP', 'DNS')).toBe(false);
    expect(protocolMatches('ANY', 'DNS')).toBe(true);
  });
  it('firewall: primera coincidencia por prioridad, luego acción por defecto', () => {
    const rules = [
      { id: 'b', priority: 100, action: 'allow' as const, protocol: 'HTTPS' as const, port: 443, source: '0.0.0.0/0' },
      { id: 'a', priority: 10, action: 'deny' as const, protocol: 'ANY' as const, port: 'ANY' as const, source: '198.51.100.0/24' }
    ];
    expect(evaluateFirewall(rules, 'deny', { protocol: 'HTTPS', port: 443, sourceIp: '198.51.100.9' }).rule?.id).toBe('a');
    expect(evaluateFirewall(rules, 'deny', { protocol: 'HTTPS', port: 443, sourceIp: '203.0.113.1' }).action).toBe('allow');
    expect(evaluateFirewall(rules, 'deny', { protocol: 'HTTP', port: 80, sourceIp: '203.0.113.1' })).toEqual({ action: 'deny' });
  });
  it('security group por componente de origen', () => {
    const rules = [{ id: 'r', protocol: 'JDBC' as const, port: 5432, sourceId: 'app' }];
    expect(matchSecurityGroup(rules, { protocol: 'JDBC', port: 5432, sourceId: 'app' })).toBeTruthy();
    expect(matchSecurityGroup(rules, { protocol: 'JDBC', port: 5432, sourceId: 'other' })).toBeUndefined();
  });
  it('ruta más corta excluye DNS', () => {
    const m = getTemplate('demo-three-tier').model();
    expect(findPath(m, 'user', 'lb')?.map((k) => k.id)).toEqual(['c-user-net', 'c-net-fw', 'c-fw-lb']);
    expect(findPath(m, 'user', 'dns')).toBeUndefined();
    expect(findPath(m, 'db', 'user')).toBeUndefined();
  });
});
