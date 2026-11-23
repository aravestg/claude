import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyzeDrawioPage, buildFromAnalysis, classify, DrawioImportError, importDrawio, parseXml, protocolFromLabel, readDrawio, validateModel } from '../src';

const inflateRaw = async (b: Uint8Array) => new Uint8Array(inflateRawSync(b));
const fixture = (f: string) => readFileSync(join(__dirname, 'fixtures', f), 'utf8');
const compressed = (xml: string) =>
  `<mxfile><diagram id="c1" name="Comprimido">${deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64')}</diagram></mxfile>`;

describe('lectura de archivos draw.io', () => {
  it('lee mxfile sin comprimir con varias páginas', async () => {
    const pages = await readDrawio(fixture('aws-three-tier.drawio'), { inflateRaw });
    expect(pages.map((p) => p.name)).toEqual(['Producción AWS', 'Borrador']);
  });
  it('lee páginas comprimidas (deflate + base64 + URI), como guarda draw.io', async () => {
    const pages = await readDrawio(compressed(fixture('generic.xml')), { inflateRaw });
    expect(pages[0]!.name).toBe('Comprimido');
    expect(analyzeDrawioPage(pages[0]!).nodes.length).toBe(5);
  });
  it('lee .drawio.svg con el diagrama embebido', async () => {
    const xml = fixture('generic.xml').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${xml}"><rect/></svg>`;
    expect((await readDrawio(svg, { inflateRaw })).length).toBe(1);
  });
  it('acepta un mxGraphModel suelto', async () => {
    expect((await readDrawio(fixture('generic.xml'), { inflateRaw }))[0]!.name).toBe('Página 1');
  });
});

describe('seguridad del parser', () => {
  it('rechaza DTD/ENTITY (XXE y billion laughs)', async () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><mxfile>&lol2;</mxfile>';
    await expect(readDrawio(evil, { inflateRaw })).rejects.toThrow(/DTD/);
  });
  it('rechaza XML mal formado y archivos sin diagrama', async () => {
    expect(() => parseXml('<a><b></a>')).toThrow();
    await expect(readDrawio('<html><body>hola</body></html>', { inflateRaw })).rejects.toThrow(DrawioImportError);
    await expect(readDrawio('<mxfile><diagram>%%%no-base64%%%</diagram></mxfile>', { inflateRaw })).rejects.toThrow(DrawioImportError);
  });
  it('no interpreta HTML de las etiquetas: lo convierte a texto plano', async () => {
    const a = analyzeDrawioPage((await readDrawio(fixture('aws-three-tier.drawio'), { inflateRaw }))[0]!);
    expect(a.nodes.find((n) => n.cellId === 'alb')!.label).toBe('Application Load Balancer');
  });
});

describe('clasificación', () => {
  it('reconoce íconos AWS, Azure, GCP y figuras genéricas', () => {
    expect(classify('shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;', '')?.type).toBe('compute.function');
    expect(classify('image;html=1;image=img/lib/azure2/databases/SQL_Database.svg;', '')?.type).toBe('data.postgresql');
    expect(classify('shape=mxgraph.gcp2.cloud_functions;', '')?.type).toBe('compute.function');
    expect(classify('shape=cylinder3;', 'Inventario')?.type).toBe('data.postgresql');
    expect(classify('rounded=1;', 'Balanceador interno')?.type).toBe('network.load_balancer');
    expect(classify('rounded=1;', 'Cosa rara')).toBeUndefined();
  });
  it('infiere protocolo y puerto del texto de la flecha', () => {
    expect(protocolFromLabel('JDBC 5432')).toEqual({ protocol: 'JDBC', port: 5432 });
    expect(protocolFromLabel('HTTP :8080')).toEqual({ protocol: 'HTTP', port: 8080 });
    expect(protocolFromLabel('HTTPS')).toEqual({ protocol: 'HTTPS', port: 443 });
  });
});

describe('construcción del modelo (AWS)', async () => {
  const r = await importDrawio(fixture('aws-three-tier.drawio'), { inflateRaw });
  it('mapea componentes y grupos anidados', () => {
    const types = Object.fromEntries(r.model.components.map((c) => [c.name, c.type]));
    expect(types).toMatchObject({
      Clientes: 'client.browser',
      'AWS WAF': 'security.firewall',
      'Application Load Balancer': 'network.load_balancer',
      'Orders API (a)': 'compute.app_server',
      'Orders DB (RDS PostgreSQL)': 'data.postgresql',
      Documentos: 'data.object_storage'
    });
    const vpc = r.model.groups.find((g) => g.kind === 'vpc')!;
    expect(vpc.props.cidr).toBe('10.0.0.0/16');
    expect(r.model.groups.find((g) => g.name.startsWith('Private'))!.parentId).toBe(vpc.id);
    expect(r.model.groups.find((g) => g.kind === 'region')).toBeTruthy();
  });
  it('convierte flechas en conexiones con protocolo/puerto', () => {
    const p = (from: string, to: string) => r.report.connections.find((k) => k.from === from && k.to === to);
    expect(p('Application Load Balancer', 'Orders API (a)')).toMatchObject({ protocol: 'HTTP', port: 8080 });
    expect(p('Orders API (a)', 'Orders DB (RDS PostgreSQL)')).toMatchObject({ protocol: 'JDBC', port: 5432 });
    expect(p('AWS WAF', 'Application Load Balancer')).toMatchObject({ protocol: 'HTTPS', port: 443 });
  });
  it('informa lo omitido y registra los supuestos', () => {
    expect(r.report.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(['Texto libre (anotación)', 'Flecha sin origen o destino conectados']));
    expect(r.model.assumptions.some((s) => s.includes('DNS (supuesto)'))).toBe(true);
    expect(validateModel(r.model).filter((f) => f.level === 'error')).toEqual([]);
  });
  it('genera escenarios acordes al diagrama', () => {
    expect(r.scenarios.map((s) => s.id)).toEqual(['imp-A-main', 'imp-B-store-down', 'imp-C-instance-down', 'imp-D-fw-block', 'imp-E-dns-down']);
  });
});

describe('construcción del modelo (genérico, comprimido)', async () => {
  const r = await importDrawio(compressed(fixture('generic.xml')), { inflateRaw, name: 'Pedidos' });
  it('usa el texto cuando la figura es genérica e invierte flechas inválidas', () => {
    expect(r.model.components.map((c) => c.type)).toEqual(
      expect.arrayContaining(['client.browser', 'network.internet', 'integration.api_gateway', 'compute.app_server', 'data.postgresql'])
    );
    expect(r.report.connections.find((k) => k.from === 'Servicio de pedidos' && k.to === 'Pedidos')?.note).toMatch(/invertido/);
    expect(r.report.skipped.some((s) => s.reason.startsWith('Figura decorativa'))).toBe(true);
  });
  it('permite corregir tipos antes de construir', async () => {
    const pages = await readDrawio(compressed(fixture('generic.xml')), { inflateRaw });
    const built = buildFromAnalysis(analyzeDrawioPage(pages[0]!), { overrides: { db: 'data.nosql', net: 'ignore' } });
    expect(built.model.components.find((c) => c.name === 'Pedidos')!.type).toBe('data.nosql');
    expect(built.model.components.some((c) => c.name === 'Internet')).toBe(false);
  });
});

describe('esquema de escenarios', async () => {
  const { parseScenarios } = await import('../src');
  it('acepta los escenarios generados y rechaza basura', async () => {
    const r = await importDrawio(fixture('aws-three-tier.drawio'), { inflateRaw });
    expect(parseScenarios(JSON.parse(JSON.stringify(r.scenarios))).ok).toBe(true);
    expect(parseScenarios([{ id: 'x' }]).ok).toBe(false);
  });
});
