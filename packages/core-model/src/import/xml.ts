/**
 * Parser XML mínimo y defensivo para archivos de diagramas (entrada NO confiable).
 * - Sin DOM: funciona en navegador, Node y workers.
 * - Rechaza DTD/ENTITY (previene XXE y expansión exponencial de entidades).
 * - Sólo decodifica las 5 entidades predefinidas y referencias numéricas.
 * - Límites de tamaño y de cantidad de nodos.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export const XML_LIMITS = { maxChars: 8_000_000, maxNodes: 50_000 };

export class XmlError extends Error {}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos|nbsp);/g, (_, e: string) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'nbsp') return ' ';
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(src: string): XmlNode {
  if (src.length > XML_LIMITS.maxChars) throw new XmlError('El archivo excede el tamaño máximo permitido');
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new XmlError('El archivo contiene DTD/ENTITY: no se permite por seguridad');
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let count = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z_:][\w:.-]*)\s*>|<([A-Za-z_:][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1 && top.name === m[2]) stack.pop();
      else throw new XmlError(`Etiqueta de cierre inesperada </${m[2]}>`);
    } else if (m[3]) {
      if (++count > XML_LIMITS.maxNodes) throw new XmlError('El diagrama tiene demasiados elementos');
      const node: XmlNode = { name: m[3], attrs: {}, children: [], text: '' };
      let a: RegExpExecArray | null;
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(m[4] ?? ''))) node.attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? '');
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
  }
  if (stack.length !== 1) throw new XmlError('XML incompleto: hay etiquetas sin cerrar');
  return root;
}

export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0, bits = 0, j = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, j);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!;
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++]! & 0x3f));
    else if (b < 0xf0) s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f));
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
      s += String.fromCodePoint(cp);
    }
  }
  return s;
}
