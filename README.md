# Architecture Studio AI — Fase 1 (PoC funcional)

Laboratorio 3D para **diseñar, simular y diagnosticar** arquitecturas de solución. Esta primera entrega es una prueba de concepto **funcional**: cada animación de la escena corresponde a un evento emitido por un motor de simulación determinista e independiente de la interfaz gráfica.

> El motor de simulación determina **lo que sucede** · el motor 3D muestra **cómo sucede** · la IA (Fase 2) explicará **por qué** y **cómo mejorarlo**.

## Inicio rápido

Requisitos: Node 22+, pnpm 10 (`corepack enable`).

```bash
pnpm install
```

```bash
pnpm dev
```

Abra `http://localhost:5173`, elija un escenario en la barra superior y pulse **▶ Simular**.

Simulación sin interfaz gráfica (CLI):

```bash
pnpm sim demo-three-tier C-db-down
```

Verificación completa:

```bash
pnpm typecheck && pnpm test:coverage && pnpm build && pnpm test:e2e
```

## Qué incluye

- **Editor 3D real** (Three.js / React Three Fiber): formas por tipo, VPC/subredes translúcidas, arcos de conexión con protocolo:puerto (discontinuas = sin cifrado), arrastre, conexión entre componentes validada, cámara orbital y vistas perspectiva/superior/lateral/isométrica, enfoque, seguimiento de la solicitud, capas y calidad gráfica.
- **Motor de simulación determinista** (Web Worker): DNS, TCP/TLS, firewall stateful (reject/drop), balanceador con health checks, API Gateway (401/429), servicios con pool, timeouts, reintentos con backoff y circuit breaker, bases de datos con Multi-AZ/failover, Security Groups (descarte silencioso) e IAM (403). Fallas de red, autorización, autenticación, disponibilidad, aplicación, capacidad y DNS se modelan de forma diferenciada.
- **Consola de simulación**: play/pause/stop/restart, paso adelante/atrás, velocidad, línea de tiempo, lista de eventos e inspector con payload sintético, encabezados, protocolo, puerto, causa y explicación básica/avanzada.
- **Diagnóstico basado en reglas** (sin IA): causa raíz y recomendaciones con severidad, evidencia, trade-offs y alternativas; cada una propone cambios que se **previsualizan y requieren aprobación**. Tabla **antes/después** al re-simular.
- **Validación estática**, **modo aprendizaje** por componente, **persistencia** local con versiones, **exportación** JSON/Mermaid/Markdown/reporte de simulación/PNG e **importación** validada.
- **Plantillas**: aplicación web de tres capas (escenario obligatorio de demostración: A éxito, B bloqueo de firewall, C falla de BD, D caída de instancia, E Security Group, F DNS) y API serverless (éxito, 401, IAM 403, 429).

## Estructura

```
packages/core-model          Architecture Model Engine: tipos, catálogo, contratos, operaciones, propuestas, validación, plantillas, exportación
packages/simulation-engine   Simulation Engine: simulate(), comportamientos, diagnóstico, CLI (sin UI)
packages/visualization-3d    3D Visualization Engine: deriveSceneState() puro + escena R3F (sin reglas técnicas)
apps/studio                  UI shell (Vite + React + Zustand), worker de simulación, E2E Playwright
docs/                        Arquitectura, ADR, criterios de aceptación, extensibilidad, DevOps
.github/                     CI, seguridad, release con gate CAB, Dependabot, plantillas
```

## Documentación

- [Arquitectura técnica](docs/architecture.md) · [ADR](docs/adr) · [Criterios de aceptación y evidencia](docs/acceptance.md) · [Extensibilidad](docs/extensibility.md)
- DevOps: [Estrategia de versionamiento](docs/devops/versioning.md) · [CI/CD](docs/devops/ci-cd.md) · [Registro de excepciones de seguridad](docs/devops/risk-register.md) · [SECURITY.md](SECURITY.md)

## Transparencia (principio P6)

Los resultados son **simulaciones conceptuales basadas en reglas**. Latencias y tiempos son estimaciones; no son mediciones de infraestructura real. Cada evento lleva `provenance: "simulation:rule-based"` e indica si sería observable en un sistema real.

## Próximas fases

- **Fase 2:** asistente IA (generación desde requisitos, explicaciones, propuestas vía el mismo flujo de aprobación), backend Node + PostgreSQL, autenticación y RBAC.
- **Fase 3:** motor de eventos discretos concurrente (capacidad, colas, fallas en cascada), comparador multi-alternativa, costos, documentación C4 completa, Draw.io/SVG.
- **Fase 4:** colaboración, aprobaciones, importación de IaC y generación asistida de infraestructura como código.
