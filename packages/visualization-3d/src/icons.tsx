/** Íconos SVG en línea (sin recursos remotos: compatible con la CSP). */
import type { ShapeKind } from '@asa/core-model';

const P: Record<ShapeKind, string> = {
  device: 'M4 5h16v10H4z M2 19h20',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  dns: 'M5 4h14v6H5z M5 14h14v6H5z M8 7h.01 M8 17h.01',
  wall: 'M12 3l8 3v6c0 5-4 8-8 9c-4-1-8-4-8-9V6z M9 12l2 2l4-4',
  distributor: 'M12 4v6 M12 10l-7 8 M12 10l7 8 M12 10v8 M9 4h6',
  gateway: 'M4 20V9l8-5l8 5v11 M9 20v-6h6v6',
  server: 'M5 4h14v6H5z M5 14h14v6H5z M8 7h.01 M8 17h.01 M12 7h4 M12 17h4',
  function: 'M7 20l5-9 M9 4c3 0 4 2 5 6l3 10',
  database: 'M5 6c0-1.7 3-3 7-3s7 1.3 7 3s-3 3-7 3s-7-1.3-7-3z M5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6 M5 12c0 1.7 3 3 7 3s7-1.3 7-3',
  nosql: 'M4 6h16v4H4z M4 14h16v4H4z M7 8h.01 M7 16h.01',
  bucket: 'M4 6h16l-2 14H6z M4 6c0-1.5 3.6-2 8-2s8 .5 8 2',
  tunnel: 'M3 18V10a9 9 0 0 1 18 0v8 M7 18v-7a5 5 0 0 1 10 0v7 M3 18h18',
  key: 'M8 14a4 4 0 1 1 0-8a4 4 0 0 1 0 8z M11 11l9 9 M16 16l2-2 M18 18l2-2',
  chart: 'M4 20V4 M4 20h16 M8 16v-5 M12 16V8 M16 16v-3',
  mail: 'M3 6h18v12H3z M3 7l9 6l9-6',
  saas: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z'
};

export function Icon({ shape, size = 16 }: { shape: ShapeKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[shape]} />
    </svg>
  );
}
