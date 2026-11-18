# Estrategia de versionamiento en GitHub

## Ramas (trunk-based con ramas cortas)

| Rama | Uso | Protección |
|---|---|---|
| `main` | Tronco siempre desplegable | PR obligatorio, 1 aprobación (CODEOWNERS cuando exista), checks requeridos: `CI / quality`, `CI / e2e`, `Security / *`; historial lineal; sin force-push |
| `feat/<ticket>-<desc>` | Funcionalidad | Vida < 3 días idealmente |
| `fix/<ticket>-<desc>` | Corrección | — |
| `chore/…`, `ci/…`, `docs/…` | Mantenimiento | — |
| `hotfix/vX.Y.Z+1` | Corrección urgente desde un tag de producción | Se fusiona a `main` y se etiqueta |
| `release/X.Y` | Sólo si hay que mantener una línea anterior | Mismos checks que `main` |

Merge: **squash** con título en *Conventional Commits* (`feat(simulation): …`, `fix(viz): …`, `feat!: …` para incompatibles).

## Versiones (SemVer 2.0)

- Tag anotado/firmado `vX.Y.Z` en `main` ⇒ release de producción (workflow `release.yml`).
- `vX.Y.Z-rc.N` ⇒ pre-release: se publica el artefacto para validación/CAB **sin desplegar**.
- La versión de `package.json` raíz debe coincidir con el tag (el workflow lo verifica).
- MAJOR: cambio incompatible de contrato o esquema; MINOR: funcionalidad compatible; PATCH: correcciones.

### Contratos

Los contratos tienen versión propia, independiente de la app:

| Constante | Archivo | Incrementar MAJOR cuando… |
|---|---|---|
| `SCHEMA_VERSION` | `core-model/src/types.ts` | Cambia la forma persistida de `ArchitectureModel` (requiere migración) |
| `CONTRACT_VERSION` | `core-model/src/contracts.ts` | Se elimina/renombra un campo o tipo de evento, o cambia su semántica |
| `WORKER_PROTOCOL` | `studio/src/sim/protocol.ts` | Cambia el mensaje UI ↔ worker |

Agregar un tipo de evento o un campo opcional es MINOR. Cambiar el comportamiento del simulador actualiza la traza golden (`pnpm --filter @asa/simulation-engine golden`) y el diff se revisa en el PR.

## Flujo de liberación

```
feat/* ──PR (CI+Security)──▶ main ──tag v1.2.0-rc.1──▶ Release (pre-release, artefactos + SBOM + provenance)
                                    │                         │
                                    │                    evidencia → CAB
                                    └──tag v1.2.0────────▶ Release ──▶ environment "production" (revisores) ──▶ deploy
```

## Evidencia para CAB (generada automáticamente)

| Evidencia | Fuente |
|---|---|
| Resultado de pruebas unitarias, de contrato y desacoplamiento + cobertura | `CI / quality` (artefacto `coverage`) |
| Pruebas E2E del escenario obligatorio (A/B/C) en navegador real | `CI / e2e` |
| SAST | CodeQL (pestaña *Security*) |
| SCA y licencias | `pnpm audit`, Dependency Review |
| Secretos | TruffleHog |
| Inventario de componentes | SBOM CycloneDX adjunto al release |
| Integridad y procedencia | `SHA256SUMS.txt` + attestation SLSA (`gh attestation verify`) |
| Aprobación | Revisión del environment `production` (quién, cuándo) |
| Rollback | Re-ejecutar el deploy del tag anterior (`Actions → Release → Re-run`) o etiquetar un hotfix |

## Configuración manual pendiente en GitHub (requiere admin)

1. Settings → Branches → regla para `main` con los checks indicados.
2. Settings → Environments → `production` con revisores requeridos (CAB) y sólo tags `v*`.
3. Settings → Pages → Source: GitHub Actions.
4. Settings → Code security → habilitar Dependabot alerts, secret scanning y push protection.
5. Habilitar firma de tags/commits requerida (opcional recomendado).
