/** Descompresión deflate-raw nativa del navegador, con tope de tamaño (defensa ante "zip bombs"). */
const MAX_INFLATED = 25 * 1024 * 1024;

export async function inflateRawBrowser(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_INFLATED) {
      await reader.cancel();
      throw new Error('El diagrama descomprimido excede el tamaño permitido');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export const MAX_DRAWIO_FILE = 5 * 1024 * 1024;
export const isDrawioName = (n: string) => /\.(drawio|xml|svg|dio)$/i.test(n);
