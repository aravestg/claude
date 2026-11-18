# ADR 0003 — Simulación determinista con reloj lógico

- **Estado:** aceptado · **Fecha:** 2026-11-18

## Contexto
Los escenarios deben ser reproducibles (criterio 18), permitir paso a paso y retroceso, y diferenciar simulación de medición (P6).

## Decisión
- Intérprete de árbol de llamadas con reloj lógico en ms y cola de eventos de fondo ordenada por tiempo (fallas programadas, failover).
- Prohibido reloj de pared y aleatoriedad en el motor (verificado por prueba). Desempates por ID de conexión.
- `simulationId` = hash FNV-1a del JSON canónico de componentes, conexiones, grupos y escenario (excluye layout, nombre y revisión).
- Traza golden versionada en `test/fixtures` como contrato observable.

## Consecuencias
- (+) Mismas entradas ⇒ mismos eventos byte a byte; diffs de comportamiento visibles en PR.
- (−) Solicitudes secuenciales: la contención real (pools compartidos, colas) queda para un motor de eventos discretos en Fase 3, manteniendo el mismo contrato de eventos.
