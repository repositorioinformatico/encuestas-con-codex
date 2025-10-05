# Arquitectura de la aplicación de encuestas

## Visión general
La aplicación se compone de un front-end estático servido por Netlify y un conjunto de Netlify Functions que actúan como API sin estado. Los datos se persisten utilizando Netlify Blobs, lo que elimina la necesidad de una base de datos tradicional y permite almacenar el estado de las encuestas en formato JSON.

```
Navegador ──▶ Front-end estático (web/) ──▶ Netlify Function `surveys`
                                           │
                                           └──▶ Netlify Blobs (surveys.json)
```

## Front-end
- **Tecnologías:** HTML/CSS/JavaScript sin framework para reducir complejidad y mantener el bundle estático.
- **Responsabilidades:**
  - Presentar formulario de autenticación para docentes.
  - Listar encuestas abiertas/cerradas y permitir la participación de estudiantes.
  - Gestionar la sesión del docente en memoria y reenviar credenciales en cada acción administrativa.
  - Calcular y persistir un *fingerprint* mínimo del cliente (hash de metadata del dispositivo + timestamp) para prevenir votos duplicados.
- **Persistencia cliente:** `localStorage` guarda `{ fingerprint, firstSeen }`. El identificador se reutiliza en llamadas posteriores y viaja en cada petición relevante.

## API (Netlify Function `surveys`)
- **Acciones soportadas:** `list`, `create`, `close`, `submit` (todas via POST + JSON).
- **Autenticación docente:** Comparación directa con credenciales predefinidas (`ximo` / `p4$$w0rd`). Las operaciones que mutan estado requieren credenciales válidas; el listado se adapta: entrega detalles completos solo a docentes.
- **Prevención de votos duplicados:** Cada respuesta se guarda con `{ fingerprint, optionIndex, firstSeen, timestamp }`. Antes de aceptar una nueva, se verifica si ese fingerprint ya participó.
- **Serialización:** Las respuestas se agregan para entregar contadores (`totals`, `totalResponses`). Para visitantes se ocultan los detalles crudos, manteniendo únicamente la agregación y la bandera `hasResponded`.
- **Persistencia:** Se utiliza `@netlify/blobs` con un blob JSON (`surveys.json`). La estructura raíz es `{ surveys: Survey[] }`.

### Esquema de datos `Survey`
```
{
  id: string,
  title: string,
  question: string,
  options: string[],
  status: 'open' | 'closed',
  createdAt: ISODate,
  closedAt: ISODate | null,
  responses: Array<{
    fingerprint: string,
    optionIndex: number,
    firstSeen: ISODate | null,
    timestamp: ISODate
  }>
}
```

## Flujo principal
1. El front-end obtiene/crea fingerprint y solicita `list`.
2. El docente se autentica: la función valida credenciales y devuelve el listado con resultados completos.
3. **Crear encuesta:** acción `create` añade un objeto `Survey` nuevo al blob.
4. **Cerrar encuesta:** acción `close` marca el estado como `closed` y fija `closedAt`.
5. **Responder encuesta:** acción `submit` valida fingerprint único, registra la respuesta y recalcula agregados.

## Consideraciones y extensiones
- **Concurrencia:** Netlify Blobs asegura consistencia eventual; para escenarios de alta concurrencia podrían considerarse locks optimistas (no necesarios para la escala prevista).
- **Seguridad:** Las credenciales viajan en texto plano sobre HTTPS (Netlify). Para mayor robustez se podría migrar a tokens firmados, pero queda fuera del alcance planteado.
- **Escalabilidad:** El almacenamiento JSON es apropiado para un número moderado de encuestas/respuestas. Ante mayor volumen se podrían segmentar blobs (p.ej., un archivo por encuesta) para reducir lecturas.
- **Auditoría:** El `fingerprint` se mantiene anonimizado (hash). Si se necesitara revocar votos, se dispone del `timestamp` y `firstSeen` asociados.
