## Resumen

<!-- Qué cambia y por qué. Título del PR en formato Conventional Commits: feat(simulation): ... -->

## Tipo de cambio

- [ ] feat (MINOR)
- [ ] fix (PATCH)
- [ ] cambio incompatible de contrato/esquema (MAJOR — requiere ADR)
- [ ] docs / chore / ci / refactor / test

## Motores afectados

- [ ] core-model (modelo, catálogo, contratos)
- [ ] simulation-engine
- [ ] visualization-3d
- [ ] studio (UI)
- [ ] CI/CD / infraestructura

## Verificación

- [ ] `pnpm typecheck && pnpm test` pasan localmente
- [ ] Si cambia el comportamiento del simulador: golden actualizado (`pnpm --filter @asa/simulation-engine golden`) y revisado el diff
- [ ] El simulador sigue sin dependencias de UI (prueba de desacoplamiento)
- [ ] Sin secretos, datos reales ni dependencias nuevas sin justificar

## Evidencia para CAB (si va a producción)

<!-- Enlace a ejecución de CI, reporte de seguridad, riesgos y plan de rollback -->
