# Contribuir

1. Rama corta desde `main`: `feat/<ticket>-<desc>` (ver `docs/devops/versioning.md`).
2. Commits y título de PR en *Conventional Commits*.
3. Antes de abrir el PR: `pnpm typecheck && pnpm test && pnpm build` (y `pnpm test:e2e` si tocas la UI).
4. Si cambias el comportamiento del simulador: `pnpm --filter @asa/simulation-engine golden` y revisa el diff.
5. Reglas de arquitectura (verificadas en CI):
   - `simulation-engine` y `core-model` no importan React, Three, DOM ni `visualization-3d`.
   - `visualization-3d` no contiene reglas de conectividad, protocolos ni autorización.
   - El modelo sólo cambia mediante `ModelOperation`.
