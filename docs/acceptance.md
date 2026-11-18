# Criterios de aceptación del MVP — evidencia observable

Cada criterio se respalda con una prueba automatizada (U = Vitest, E = Playwright con WebGL) o con una verificación manual reproducible.

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Entorno 3D real | Three.js/R3F (`visualization-3d/src/Scene.tsx`); E: canvas WebGL visible en `e2e/demo.spec.ts` |
| 2 | Recursos seleccionables y editables | Inspector con editor de propiedades → `update_component`; U: `core-model.test.ts › operaciones` |
| 3 | Conexiones con semántica técnica | Protocolo/puerto validados contra el catálogo; U: «rechaza todo el lote si una operación es inválida», «compatibilidad de protocolos» |
| 4 | Modelo persistente | Autoguardado + versiones + JSON; E: «el modelo es persistente…» |
| 5 | Simulador funciona sin Three.js | U: `decoupling.test.ts › 1`; CI ejecuta `pnpm sim` (CLI Node) |
| 6 | Animaciones provienen de eventos estructurados | `deriveSceneState` sólo lee `SimulationEvent[]`; U: `derive.test.ts` con traza pregrabada |
| 7 | Cámara con rotación libre | `OrbitControls` + vistas preestablecidas |
| 8 | Comunicaciones animadas | Paquete con estela por cada evento `transfer` |
| 9 | Inspección de cada paso | Inspector de simulación (payload, encabezados, protocolo, puerto, causa); E: «paso a paso y retroceso» |
| 10 | Provocar un bloqueo | Escenario B (`setup` vía propuesta) y E (Security Group); E: escenario B |
| 11 | El bloqueo aparece en el lugar correcto | U: «el bloqueo aparece en el firewall con la regla causante»; E: etiqueta `fw` con «Denegado» |
| 12 | La causa queda explicada | Evento `ACCESS_DENIED` con regla, prioridad y explicación básica/avanzada + recomendación |
| 13 | El usuario puede corregir la configuración | Editor de reglas del firewall o «Aceptar y previsualizar»; U/E: corrección y re-simulación |
| 14 | El escenario puede ejecutarse nuevamente | E: escenario B re-simulado con éxito y tabla antes/después |
| 15 | Falla de dependencia | Escenario C; U: timeouts, reintentos con backoff, propagación 503 |
| 16 | Línea de tiempo reproducible | Play/Pause/Stop/Restart/Step ±/velocidad/scrubber; U: `advancePlayhead` |
| 17 | Cambiar posiciones 3D no altera la lógica | U: «mover todos los componentes no cambia ni un evento» |
| 18 | Escenarios reproducibles | U: dos ejecuciones idénticas + traza golden |
| 19 | Pruebas básicas del motor | `pnpm test` (70 pruebas) con umbral de cobertura en CI |
| 20 | Diferencia simulación y medición real | `provenance` en cada evento/resultado, banner permanente, `observableInRealSystem`, supuestos en reportes |

## Pruebas de desacoplamiento (sección 10.6)

| Punto | Prueba |
|---|---|
| 1. Simulador sin interfaz gráfica | `decoupling.test.ts › no importa React, Three.js…` + Web Worker en la UI |
| 2. Resultados reproducibles | `decoupling.test.ts › dos ejecuciones producen eventos idénticos` |
| 3. Renderizador con eventos pregrabados | `visualization-3d/test/derive.test.ts` (usa el golden sin ejecutar el simulador) |
| 4. La cámara no altera el resultado | El estado de cámara no existe en el modelo ni en el contrato del simulador (`decoupling.test.ts › el modelo no contiene estado de cámara…`) |
| 5. Posiciones 3D no alteran reglas | `decoupling.test.ts › mover todos los componentes…` |
| 6. La IA no modifica sin autorización | `core-model.test.ts › 6. control de cambios` (propuestas `pending/rejected/postponed` lanzan error) |
| 7. Eventos reutilizables | `decoupling.test.ts › 7` (JSON sin pérdida) + CLI `--json` |
