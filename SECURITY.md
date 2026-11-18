# Política de seguridad

## Reporte de vulnerabilidades
Reporte vulnerabilidades mediante *GitHub Security Advisories* (Security → Report a vulnerability). No abra issues públicos con detalles explotables.

## Controles implementados (Fase 1)

- **Entradas no confiables validadas** con zod: importación de JSON (límite 2 MB), `localStorage`, mensajes del worker y operaciones (IDs con lista blanca de caracteres, longitudes y tamaños máximos).
- **Content Security Policy** estricta en `index.html` (`script-src 'self'`, sin `eval`, `object-src 'none'`, `connect-src 'self'`). Sin recursos remotos (fuentes, HDRs, CDNs).
- **Sin ejecución sobre infraestructura real:** la simulación es aislada y usa sólo datos sintéticos.
- **Control de cambios:** ninguna propuesta (motor de reglas o futura IA) se aplica sin aprobación explícita; las propuestas obsoletas se rechazan salvo rebase seguro.
- **Cadena de suministro:** lockfile congelado, acciones fijadas por SHA, CodeQL, Dependency Review, `pnpm audit`, TruffleHog, SBOM CycloneDX y attestation de procedencia en releases. Excepciones en `docs/devops/risk-register.md`.

## Pendiente para Fase 2 (backend)
Autenticación OIDC, RBAC por proyecto, cifrado en reposo, auditoría, rate limiting, política de retención y protección contra prompt injection (ADR 0005).
