# Arquitectura técnica — Architecture Studio AI (Fase 1 · PoC)

> **Principio central.** El motor de simulación determina **lo que sucede**. El motor 3D muestra
> **cómo sucede**. La IA (Fase 2) explicará **por qué** y **cómo mejorarlo**.

## 1. Vista de módulos

```
                        ┌───────────────────────────── apps/studio (ui-shell) ─────────────────────────────┐
                        │  TopBar · Catálogo · Inspector · Consola/Timeline · Diagnóstico · Validación      │
                        │  Zustand (estado de UI, historial undo/redo)                                      │
                        └───────┬──────────────────────────┬──────────────────────────────┬─────────────────┘
          ModelOperation[]      │                          │ postMessage (asa-sim/1)       │ SceneState
                                ▼                          ▼                               ▼
┌──────────────── packages/core-model ────────────┐  ┌── Web Worker ─────────────────┐  ┌── packages/visualization-3d ──┐
│ Architecture Model Engine (fuente de verdad)    │  │ packages/simulation-engine    │  │ 3D Visualization Engine       │
│ · tipos, catálogo declarativo, props tipadas    │◀─│ · simulate(model, scenario)   │  │ · deriveSceneState(events)    │
│ · contratos versionados (eventos, escenarios)   │  │ · comportamientos por tipo    │  │ · R3F/Three: formas, arcos,   │
│ · applyOperations (única vía de mutación)       │  │ · reloj lógico, fallas,       │  │   partículas, grupos, cámara  │
│ · propuestas con aprobación (P5)                │  │   retries, circuit breaker    │  │ · SIN reglas técnicas         │
│ · validación estática · zod · exportaciones     │  │ · diagnose() → recomendaciones│  │                               │
└─────────────────────────────────────────────────┘  └───────────────────────────────┘  └───────────────────────────────┘
        ▲ depende sólo de zod                              ▲ depende sólo de core-model         ▲ depende de core-model (tipos)
```

Dependencias permitidas (sin ciclos):

| Paquete | Puede depender de | No puede depender de |
|---|---|---|
| `@asa/core-model` | `zod` | React, Three, DOM, otros paquetes |
| `@asa/simulation-engine` | `core-model` | React, Three, DOM, `visualization-3d` |
| `@asa/visualization-3d` | `core-model` (tipos/catálogo), React/R3F (peer) | `simulation-engine` |
| `@asa/studio` | todos | — |

Las restricciones del simulador se verifican automáticamente en `packages/simulation-engine/test/decoupling.test.ts`.

Correspondencia con la estructura modular sugerida en la especificación:

| Módulo sugerido | Implementación PoC |
|---|---|
| core-model, component-catalog, rule-engine (estático) | `packages/core-model` (`catalog/`, `validation.ts`) |
| simulation-engine, rule-engine (dinámico) | `packages/simulation-engine` (`behaviors/`, `recommendations.ts`) |
| scenario-manager | escenarios en `core-model/src/templates` + selección en `studio` |
| visualization-3d | `packages/visualization-3d` |
| documentation-engine, export-engine | `core-model/src/export.ts` + exportaciones de `studio` |
| project-management | `studio/src/persistence.ts` (local, Fase 1) |
| ai-architect | Fase 2 — punto de integración: `ChangeProposal` (`source: 'ai'`) |
| ui-shell | `apps/studio` |

## 2. Modelo de datos

`ArchitectureModel` (`packages/core-model/src/types.ts`) — JSON puro, versionado por `schemaVersion` y `revision`:

- `components[]`: `{ id, type, name, props }` — `type` referencia una `ComponentDefinition` del catálogo; `props` son *overrides* sobre `defaultProps`.
- `connections[]`: `{ id, sourceId, targetId, protocol, port, props: { latencyMs, encrypted } }` — validadas contra los puertos/protocolos del catálogo.
- `groups[]`: VPC, subredes, regiones, datacenters (anidables con `parentId`).
- `layout.positions`: **presentación** únicamente. El simulador y `computeSimulationId` lo ignoran.
- `assumptions[]`: supuestos explícitos (P6).

`ComponentDefinition` (catálogo): `behavior` (lo usa el simulador), `shape`/`layer` (los usa el motor 3D), `inbound`/`outboundProtocols`, `defaultProps`, `equivalents` multi-proveedor (AWS/Azure/GCP/on-prem) y contenido de aprendizaje básico/avanzado.

Persistencia objetivo (Fase 2, PostgreSQL): `projects`, `model_versions (jsonb, revision)`, `scenarios`, `simulation_runs (simulation_id, events jsonb)`, `recommendations`, `proposals (status, source, base_revision)`, `adrs`, `audit_log`. El modelo JSON y los eventos ya son serializables sin pérdida (probado).

## 3. Contratos entre motores (`contracts.ts`, `CONTRACT_VERSION = 1.0.0`)

| Contrato | Productor → Consumidor | Notas |
|---|---|---|
| `ModelOperation[]` | Editor / motor de reglas / IA → Model Engine | Validado con zod, aplicación atómica, incrementa `revision`. |
| `ChangeProposal` | Motor de reglas / IA → Usuario → Model Engine | `pending → approved/rejected/postponed → applied`. `applyProposal` lanza error si no está aprobada. |
| `Scenario` | Plantillas / usuario → Simulation Engine | Fallas = condiciones de ejecución (no modifican el modelo). `setup` = configuración propuesta al modelo. |
| `SimulationEvent` (1.1.0: eventos asíncronos) | Simulation Engine → Visualización / consola / CLI / reportes | `id, simulationId, seq, t (lógico), duration, type, kind, status, sourceId, targetId, connectionId, traceId, causedBy, failure, data, explanation{basic,advanced}, observableInRealSystem, provenance`. |
| `SimulationResult` | Simulation Engine → UI / export | Incluye `requests[]` con causa raíz, `affectedComponentIds`, `provenance.disclaimer`. |
| `asa-sim/1` | UI ↔ Web Worker | `{ id, model, scenario }` → `{ ok, result, recommendations }`. |

Reglas de versionado de contratos: ver `docs/devops/versioning.md#contratos`.

## 4. Motor de simulación

- **Modelo de ejecución:** intérprete de árbol de llamadas con **reloj lógico** y cola de eventos de fondo (fallas programadas, failover). Determinista: sin reloj de pared ni aleatoriedad; desempates por ID. `simulationId = fnv1a(JSON canónico de la semántica)`.
- **Comportamientos** (`behaviors/`): `client` (DNS → ruta BFS → SYN por tramo → TLS → solicitud), `firewall` (stateful: evalúa el SYN, primera regla por prioridad, `reject` = RST / `drop` = timeout), `load_balancer` (health checks, round robin, 503/504), `api_gateway` (autenticación 401, throttling 429, timeout de integración), `service` (procesamiento, pool, timeouts, reintentos con backoff exponencial, circuit breaker con half-open), `datastore` (disponibilidad, Multi-AZ + failover, Security Group con descarte silencioso, IAM 403).
- **Comunicación asíncrona:** conexiones marcadas `async` se despachan sin esperar (`ASYNC_DISPATCHED`); la entrega se resuelve en segundo plano y su falla no afecta la respuesta (`ASYNC_DELIVERY_FAILED`).
- **Fallas diferenciadas** (`FailureCategory`): `network`, `authorization`, `authentication`, `availability`, `application`, `capacity`, `dns`. Un descarte de Security Group se marca `observableInRealSystem: false` porque en producción sólo se vería un timeout.
- **Diagnóstico** (`diagnose`): desde el evento causa raíz de cada solicitud fallida produce `Recommendation` (formato de la sección 12) con `ChangeProposal` pendiente.
- **Supuestos documentados:** solicitudes de un escenario secuenciales; un servicio llama a todas sus dependencias síncronas en cada solicitud (en el orden del diagrama); latencias estimadas; TLS termina en el balanceador; el timeout total del cliente no interrumpe trabajo en curso aguas abajo.

## 5. Motor de visualización 3D

- `deriveSceneState(events, cursor, progress)` es **puro**: traduce eventos ya producidos a estados visuales (componentes, conexiones, paquete en vuelo, foco). Retroceder = recalcular hasta un cursor anterior. Probado con la traza golden, sin WebGL.
- Reproducción en espacio de eventos con pesos (`displayWeight`), de modo que esperas largas (timeouts de 2 s) no congelan la animación; el tiempo lógico real se muestra siempre.
- Lenguaje visual: azul solicitud, verde éxito, cian DNS, violeta consulta a datos, amarillo espera/reintento, rojo error/bloqueo, gris caído. Siempre con símbolo + texto (no sólo color); líneas discontinuas = tramo sin cifrado.
- Interacción: selección, arrastre sobre el plano (genera `move_component`), modo conectar (valida compatibilidad en el modelo), doble clic para enfocar, vistas perspectiva/superior/lateral/isométrica, seguimiento de la solicitud, capas, calidad gráfica alta/baja (no altera resultados).

## 6. Decisiones (ADR)

| ADR | Decisión |
|---|---|
| [0001](adr/0001-motores-desacoplados.md) | Motores desacoplados con contratos tipados y versionados |
| [0002](adr/0002-stack-tecnologico.md) | Stack: TypeScript, pnpm monorepo, Vite + React + R3F, Zustand, zod |
| [0003](adr/0003-simulacion-determinista.md) | Simulación determinista con reloj lógico y eventos estructurados |
| [0004](adr/0004-persistencia-fase1.md) | Persistencia local en Fase 1; backend Node + PostgreSQL en Fase 2 |
| [0005](adr/0005-ia-propuestas-controladas.md) | IA independiente del proveedor, sólo vía propuestas validadas y aprobadas |

## 7. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fidelidad del simulador percibida como medición real | Decisiones erróneas | Procedencia en cada evento y banner permanente; supuestos en el modelo y en reportes |
| Crecimiento del catálogo con lógica ad-hoc | Deuda técnica | Comportamientos genéricos por `behavior`; nuevos tipos = nueva definición declarativa |
| Rendimiento con cientos de nodos (etiquetas HTML, sombras) | Fluidez | Calidad baja sin sombras/antialias; pendiente: `InstancedMesh`, LOD, etiquetas por proximidad |
| Concurrencia real (solicitudes paralelas, contención de pool) | Escenarios de capacidad limitados | Fase 3: motor de eventos discretos con cola de prioridad sobre el mismo contrato de eventos |
| Prompt injection al integrar IA | Cambios no deseados | ADR 0005: salidas estructuradas + zod + aprobación humana + auditoría |
| Dependencias de build con CVEs sin parche | Cadena de suministro | SCA en CI, Dependabot, registro de excepciones con fecha de revisión |

## 8. Rendimiento (métricas verificables, PoC)

| Métrica | Cómo medir | Valor observado (Chromium headless, SwiftShader) |
|---|---|---|
| Tiempo de simulación demo C (3 solicitudes, ~130 eventos) | `runtime` en la UI (worker) | < 20 ms |
| Tamaño del bundle (gzip) | `pnpm build` | ~370 KB (three ≈ 181 KB, r3f/drei ≈ 131 KB, app ≈ 58 KB) |
| Tiempo de suite unitaria | `pnpm test` | < 2 s |

Capacidad máxima de nodos: pendiente de un benchmark documentado (Fase 3).
