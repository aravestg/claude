# ADR 0004 — Persistencia local en Fase 1

- **Estado:** aceptado · **Fecha:** 2026-11-18

## Decisión
- Fase 1: autoguardado y versiones en `localStorage`, exportación/importación JSON validada con zod (máx. 2 MB).
- Fase 2: API Node modular + PostgreSQL (proyectos, versiones del modelo en `jsonb`, ejecuciones, propuestas, ADR, auditoría), autenticación OIDC y autorización por roles con aislamiento por proyecto.

## Consecuencias
- (+) PoC sin infraestructura ni datos sensibles en servidores.
- (−) Sin colaboración ni historial compartido hasta Fase 2.
