/** Copia profunda de datos JSON (el modelo es JSON puro por contrato). Portable: navegador, Node y workers. */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
