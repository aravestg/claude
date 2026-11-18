# ADR 0002 — Stack tecnológico de la Fase 1

- **Estado:** aceptado · **Fecha:** 2026-11-18

## Decisión
| Área | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript estricto (`noUncheckedIndexedAccess`) | Contratos tipados compartidos entre motores |
| Monorepo | pnpm workspaces | Instalaciones deterministas (`--frozen-lockfile`), aislamiento de dependencias por paquete |
| 3D | Three.js + React Three Fiber + Drei | Madurez, ecosistema, WebGL estable. WebGPU se evaluará cuando su soporte sea general |
| UI | React 19 + **Vite** (SPA) | La escena es 100 % cliente; Next.js no aporta en la PoC (sin SSR/API). Se reevaluará al incorporar backend |
| Estado UI | Zustand | Simple, sin boilerplate, fuera del modelo |
| Validación | zod 4 | Entradas no confiables (import, storage, IA) |
| Pruebas | Vitest (unit/contrato), Playwright (E2E con WebGL) | Rápidas y ejecutables en CI |
| Estilos | CSS con tokens (tema claro/oscuro) | Evita una dependencia más; Tailwind es opcional a futuro |

## Consecuencias
- Desviación consciente de la sugerencia (Next.js/Tailwind) documentada; la migración a Next.js no afecta a los paquetes de motores.
