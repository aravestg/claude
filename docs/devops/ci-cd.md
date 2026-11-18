# CI/CD

| Workflow | Disparador | Jobs | Bloquea merge |
|---|---|---|---|
| `ci.yml` | PR, push a `main`/`release/**` | `quality`: install `--frozen-lockfile` → typecheck → tests con umbral de cobertura → simulación headless (CLI) → build. `e2e`: Playwright + Chromium con WebGL (SwiftShader) | Sí |
| `security.yml` | PR, push a `main`, semanal | CodeQL (security-extended), Dependency Review (high + licencias copyleft fuertes), `pnpm audit` (prod: moderate; todo: high), TruffleHog, SBOM | Sí |
| `release.yml` | tag `vX.Y.Z[-rc.N]` | verificación tag = versión, auditoría, pruebas, build con base path de Pages, tar.gz + SHA256 + SBOM + attestation, GitHub Release, deploy con gate `production` | — |

Prácticas aplicadas:

- Acciones de terceros **fijadas por SHA** (comentario con la versión); Dependabot las actualiza.
- `permissions: contents: read` por defecto; permisos elevados sólo en el job que los necesita.
- `persist-credentials: false` en checkout; `harden-runner` en modo auditoría de egress (pasar a `block` con allowlist cuando se estabilice).
- `concurrency` para cancelar ejecuciones obsoletas (excepto releases).
- Sin secretos requeridos en la Fase 1.

## Ejecución local equivalente

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test:coverage && pnpm build
pnpm test:e2e
pnpm audit --audit-level=high
```
