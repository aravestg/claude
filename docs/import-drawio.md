# Importar diagramas de draw.io

Convierte un diagrama de draw.io (diagrams.net) en un modelo arquitectónico simulable y navegable en 3D.

## Cómo usarlo

1. **Importar draw.io** (barra superior o árbol lateral), o arrastrar el archivo sobre el lienzo.
2. Formatos: `.drawio`, `.xml`, `.drawio.svg` (exportado con "Incluir copia del diagrama"). Páginas comprimidas o sin comprimir; si hay varias páginas, se elige cuál.
3. **Revisión**: cada figura muestra el tipo detectado y su confianza (`alta · estilo`, `media · texto`, `ninguna · por defecto`). Puede corregir el tipo o ignorar la figura. Se listan conexiones, grupos, advertencias y elementos omitidos con su motivo.
4. **Importar y abrir en 3D**: el modelo se carga con escenarios generados y queda en el árbol como «Importado».

## Qué se reconoce

| Origen | Ejemplos | Resultado |
|---|---|---|
| Íconos AWS (`mxgraph.aws4.*`) | users, waf, application_load_balancer, ec2, ecs, lambda, api_gateway, rds, aurora, dynamodb, s3, route_53 | Tipo del catálogo correspondiente |
| Íconos Azure / GCP | Function Apps, API Management, Load Balancers, SQL Database, Cosmos DB, Storage; Cloud Functions, Cloud SQL, Cloud Run… | Ídem |
| Figuras genéricas | cilindro → base de datos, nube → Internet, actor → usuario, `networks.firewall` → firewall | Confianza media |
| Texto de la figura (ES/EN) | "Balanceador", "API Gateway", "Base de datos", "Lambda", "Usuarios"… | Confianza media/baja |
| Contenedores | grupos AWS (`group_vpc`, `group_region`, subredes), swimlanes, rectángulos que contienen figuras | Grupos (VPC, subred, región, zona, datacenter) con CIDR si aparece en el texto |
| Flechas | texto "HTTPS", "HTTP :8080", "JDBC 5432", "DNS" | Conexión con protocolo/puerto; si el texto no dice nada, se usa el protocolo compatible del catálogo |

Las flechas dibujadas en sentido técnicamente imposible (p. ej. *BD → servicio*) se invierten y se informa. Las flechas sin origen/destino, los textos libres y las figuras decorativas se omiten y se informan.

## Disposición en 3D

- **Ordenar por flujo de tráfico** (predeterminado): capas de izquierda a derecha según el recorrido desde los clientes, ordenadas para reducir cruces. Las zonas del diagrama original se ocultan (reactivables en «Capas → Zonas»).
- **Conservar la del diagrama**: respeta las posiciones de draw.io (escala robusta + separación mínima).
- En cualquier momento: botón **⇢ Ordenar flujo** en la escena (deshacer con Ctrl+Z). Es sólo presentación: no altera la simulación.
- Durante la simulación, lo que la solicitud aún no tocó se **atenúa** para que el camino activo se lea con claridad.

## Patrones de diagramas reales que se interpretan

| Patrón | Interpretación |
|---|---|
| Conectores fuera de página (círculos Ⓐ, Ⓑ…) | Se unen las flechas que entran y salen del conector con la misma letra |
| Flechas entre grupos (p. ej. *Red corporativa → Subred frontend*) | Componente representativo: salida por la VPN/tránsito del cliente, entrada por el balanceador, o el que nombra el texto |
| Notas, tablas de reglas, leyendas, *route tables* | Se omiten e informan |
| Flechas «cifra», «adjunta cert», «Pull image (deploy)» | Relaciones de configuración o ciclo de vida: no son tráfico, se omiten |
| «TCP 5432 (PostgreSQL/TLS)» / «TCP 3000» | JDBC 5432 / HTTP 3000 (se conserva el puerto L4) |
| Numeración ①②③ o «1.», «2.» en las flechas | Orden de las llamadas del servicio |
| Endpoints / PrivateLink sin flecha de salida | Se enlazan al servicio o grupo que nombran (supuesto) |
| «email», «webhook», «cola», «evento», «logs» o destino email/monitoreo | **Conexión asíncrona** |

## Comunicación asíncrona

Una conexión asíncrona (editable en el inspector de conexión) hace que el emisor **no espere** respuesta: el simulador emite `ASYNC_DISPATCHED` y resuelve la entrega en segundo plano (`ASYNC_DELIVERED` o `ASYNC_DELIVERY_FAILED`). Si el destino cae, la solicitud del usuario no falla, pero la pérdida queda registrada y el diagnóstico recomienda una cola durable con DLQ. Contrato de eventos 1.1.0 (cambio MINOR).

## Completado mínimo para poder simular (queda como supuesto)

- Si no hay usuarios, se agrega **Usuario (supuesto)** que llama al punto de entrada.
- Si no hay DNS, se agrega **DNS (supuesto)** con un registro hacia el primer balanceador/gateway/servicio alcanzable.
- Security Groups de bases de datos: sólo los orígenes dibujados.
- Permisos IAM mínimos para los servicios que acceden a almacenes que lo requieren.
- Firewalls: se permiten los protocolos/puertos dibujados hacia ellos.

Cada uno se registra en `model.assumptions` y se muestra al terminar la importación.

## Escenarios generados

Flujo principal; caída del primer almacén de datos; caída de una instancia detrás del balanceador (si hay ≥ 2); bloqueo en el firewall (si existe); falla de DNS.

## Seguridad

- El archivo se procesa **sólo en el navegador**; no se envía a ningún servidor.
- Parser XML propio sin DOM: rechaza DTD/ENTITY (XXE, *billion laughs*), límites de tamaño (5 MB de archivo, 25 MB descomprimido, 50 000 nodos).
- El HTML de las etiquetas se convierte a texto plano (nunca se inserta como HTML).
- El modelo resultante se valida con el mismo esquema zod que cualquier importación.

## Extender el mapeo

```ts
import { registerDrawioRule } from '@asa/core-model';
registerDrawioRule({ type: 'data.postgresql', style: /mxgraph\.mi_empresa\.oracle/, confidence: 'alta' });
```

Implementación: `packages/core-model/src/import/` (`xml.ts`, `mapping.ts`, `drawio.ts`). Pruebas: `packages/core-model/test/drawio.test.ts` y `packages/simulation-engine/test/import.test.ts` (los diagramas importados se simulan con el motor real).
