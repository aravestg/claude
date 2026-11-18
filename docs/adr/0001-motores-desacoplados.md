# ADR 0001 — Motores desacoplados con contratos tipados

- **Estado:** aceptado · **Fecha:** 2026-11-18

## Contexto
La especificación exige (sección 10) que simulación, visualización 3D e IA sean independientes, que el motor 3D nunca invente comportamiento y que los eventos se puedan reproducir sin renderizar.

## Decisión
- Tres paquetes con dependencias unidireccionales (`core-model` ← `simulation-engine`, `core-model` ← `visualization-3d`) y una UI que los compone.
- El modelo sólo cambia mediante `ModelOperation[]` validadas.
- La simulación produce `SimulationEvent[]` serializables; la visualización sólo consume eventos (`deriveSceneState`).
- En la UI, el simulador corre en un **Web Worker** (sin DOM ni WebGL), con fallback al hilo principal.

## Consecuencias
- (+) Simulador testeable headless, reutilizable desde CLI, backend o pipelines de CI.
- (+) Pruebas automáticas de desacoplamiento (imports prohibidos, dependencias, determinismo, invariancia ante layout).
- (−) Cada nuevo efecto visual requiere que el simulador emita un evento que lo justifique (intencional: P3).
