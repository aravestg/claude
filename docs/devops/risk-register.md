# Registro de excepciones de seguridad

Toda excepción a los gates de seguridad se registra aquí con justificación y fecha de revisión.

| ID | Paquete | Severidad | Alcance | Justificación | Mitigación | Revisar |
|---|---|---|---|---|---|---|
| GHSA-fc5q-39xc-vjpf | `picomatch@4.0.7` (vía `vite`, `vitest`) | High (ReDoS) | Sólo tooling de build/test; **no se incluye en el bundle desplegado** (`pnpm audit --prod` limpio) | No existe versión parcheada publicada (última: 4.0.7). Los patrones glob los define el equipo, no entradas externas | Ignorado en `package.json → pnpm.auditConfig.ignoreGhsas`; Dependabot semanal; eliminar al publicarse el parche | 2026-12-18 |

## Correcciones aplicadas en esta entrega

| Paquete | Antes | Después | Motivo |
|---|---|---|---|
| `zod` (runtime) | 3.25.76 | 4.6.7 | Agotamiento de memoria al validar entradas grandes (high) |
| `vitest`, `@vitest/coverage-v8` | 3.2.7 | 5.1.1 | Prototype pollution → RCE en `tinypool` (critical), path traversal y code injection en `@vitest/mocker` |
