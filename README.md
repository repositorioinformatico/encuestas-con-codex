# Encuestas con Netlify Blobs

Aplicación ligera para docentes que permite crear y cerrar encuestas en vivo, mientras que el alumnado responde una sola vez gracias a un fingerprint anónimo almacenado en `localStorage`. Toda la persistencia se realiza mediante [Netlify Blobs](https://docs.netlify.com/blobs/overview/) y una única función serverless.

## Requisitos
- Node.js 18 o superior (Netlify usa 22.x por defecto).
- Acceso a una cuenta de Netlify con soporte para funciones y Blobs.
- Token de Blobs generado en **User settings → Tokens**.

## Desarrollo local
```bash
npm install          # instala netlify-cli y dependencias de la función
npx netlify dev      # levanta la función y sirve /web en http://localhost:8888
```

El inicio de sesión docente está fijado en `ximo` / `p4$$w0rd`. Toda acción administrativa reenvía esas credenciales en cada llamada para mantener la sesión.

## Variables de entorno necesarias
Configura estas variables en Netlify (o en `.env` si usas `netlify dev`):

- `NETLIFY_SITE_ID`: identificador del sitio (Site settings → Site information → API ID).
- `NETLIFY_BLOBS_TOKEN`: token personal con acceso a Blobs.

## Flujo de despliegue
1. Conecta el repositorio `repositorioinformatico/encuestas-con-codex` en Netlify.
2. Asegúrate de que `publish = web` y `functions = netlify/functions` en `netlify.toml`.
3. Define las variables de entorno anteriores y despliega (`Deploy site`).

Los pushes a `main` vuelven a construir la función y publican la versión estática.

## Estructura
```
web/                   # HTML/CSS/JS del cliente
netlify/functions/     # Función serverless (surveys)
docs/architecture.md   # Descripción de diseño y decisiones
```
