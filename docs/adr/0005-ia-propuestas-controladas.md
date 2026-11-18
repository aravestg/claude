# ADR 0005 — IA controlada mediante propuestas estructuradas (Fase 2)

- **Estado:** propuesto · **Fecha:** 2026-11-18

## Decisión
- Capa `ai-architect` independiente del proveedor (interfaz `LLMProvider`), con salidas estructuradas (JSON schema = `operationSchema` de zod).
- La IA nunca modifica el modelo ni objetos 3D: produce `ChangeProposal { source: 'ai', operations, baseRevision }`, que pasa por `previewProposal` (dry-run) y requiere aprobación (`applyProposal` lanza error si no está aprobada — ya implementado y probado).
- Contexto enviado a la IA: modelo sin layout, hallazgos de validación, eventos y causa raíz de la última simulación. Nunca secretos ni datos reales.
- Defensa ante prompt injection: el contenido del modelo (nombres, descripciones) se trata como datos; validación de esquema estricta; límites de tamaño; auditoría de propuestas y decisiones.

## Consecuencias
- El motor de reglas de Fase 1 ya usa exactamente este flujo, por lo que la UI de aceptación/rechazo/posposición se reutiliza.
