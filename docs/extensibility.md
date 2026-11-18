# Extensibilidad

## Agregar un tipo de componente
Agregue una `ComponentDefinition` en `packages/core-model/src/catalog/definitions.ts` (o en tiempo de ejecución con `registerDefinition`). Si su comportamiento encaja en uno existente (`service`, `datastore`, `firewall`, …) **no se escribe lógica nueva**:

```ts
registerDefinition({
  ...getDefinition('data.postgresql'),
  type: 'data.oracle', label: 'Oracle Database', technology: 'Oracle 19c',
  inbound: [{ protocol: 'JDBC', port: 1521 }],
  defaultProps: { ...getDefinition('data.postgresql').defaultProps, engine: 'Oracle 19c' },
  equivalents: { aws: 'RDS for Oracle', onprem: 'Oracle en datacenter' }
});
```

## Agregar un comportamiento
1. Añada el valor a `BehaviorKind` y sus props tipadas en `types.ts` (+ accessor en `props.ts`).
2. Implemente el handler en `simulation-engine/src/behaviors/` emitiendo eventos del contrato (si necesita un tipo de evento nuevo, agréguelo a `EVENT_TYPES` — cambio MINOR).
3. Agregue una forma en `visualization-3d/src/shapes.tsx` (sólo presentación).
4. Pruebas: escenario de éxito y de falla en `scenarios.test.ts`.

## Agregar un escenario o plantilla
Cree un archivo en `core-model/src/templates/` que exporte `model()` y `scenarios()`, regístrelo en `templates/index.ts`. Cada escenario declara `faults` (condiciones de ejecución), `setup` opcional (configuración que se propone al modelo con confirmación) y `expectation` (verificada automáticamente por la suite).

## Consumir eventos en otra interfaz
`simulate()` devuelve JSON puro: puede ejecutarse en Node (`pnpm sim <plantilla> <escenario> --json`), en un backend o en un pipeline, y los eventos pueden alimentar otra UI o un generador de reportes sin Three.js.
