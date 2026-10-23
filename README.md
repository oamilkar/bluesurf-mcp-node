# bluesurf-mcp (Node.js)

Servidor MCP local de **solo lectura** para que Cursor u otros agentes lean
tickets de **BlueSurf**. 
El CLI es `login`, `logout`, y sin argumentos el servidor por stdio.

**Solo lectura por diseño:** no hay operaciones de escritura. El kanban se
consulta con un POST de filtro.

Hace falta **Node.js 20 o superior**.

## Instalación

```bash
npm install -g bluesurf-mcp
bluesurf-mcp --help
```

## Desarrollo

Desde esta carpeta:

```bash
npm install
npm run build
npm test
node dist/bin.js --help
```

`npm test` compila y corre la suite (sin red).  
`npm publish` compila antes de empaquetar. 

## Guardar credenciales (`login` / `logout`)

La contraseña no va en `mcp.json`. Una vez, en una terminal:

```bash
bluesurf-mcp login
```

Pide usuario y contraseña, valida contra BlueSurf y guarda la contraseña en el
almacén del sistema (Credential Manager en Windows, Keychain en macOS, Secret
Service en Linux). El username queda en un JSON local, sin la contraseña.

El servicio se llama `bluesurf-mcp-node` y el usuario vive en:

- Windows: `%LOCALAPPDATA%\bluesurf-mcp-node\config.json`
- macOS / Linux: `~/.config/bluesurf-mcp-node/config.json` (o `XDG_CONFIG_HOME`)

```bash
bluesurf-mcp logout
```

borra lo guardado.

## Configuración (variables de entorno)

El entorno **gana** sobre lo guardado con `login`.

Claves canónicas `BLUESURF_*`; se aceptan `SURF_*` como fallback.

- `BLUESURF_BASE_URL` — URL base (opcional; default `https://surf.bluepeople.com`).
- `BLUESURF_COOKIE` — cookie de sesión ya válida → usa `CookieAuth`.
- `BLUESURF_USERNAME` + `BLUESURF_PASSWORD` — credenciales → usa `CredentialsAuth`.

Precedencia: cookie en env → usuario/contraseña en env → `bluesurf-mcp login`.

El núcleo no persiste secretos. La cookie de sesión vive en memoria mientras
corre el proceso.

## Correr el servidor

```bash
bluesurf-mcp
```

Se comunica por **stdio**. Sin argumentos no pide contraseña: usa el entorno o
las credenciales de `login`.

## Registrar el MCP en Cursor

Con el paquete instalado de forma global:

```json
{
  "mcpServers": {
    "bluesurf": {
      "command": "bluesurf-mcp"
    }
  }
}
```

`npx` descarga el paquete y ejecuta su binario:

```json
{
  "mcpServers": {
    "bluesurf": {
      "command": "npx",
      "args": ["-y", "bluesurf-mcp"]
    }
  }
}
```

`-y` evita la pregunta de confirmación de npx. Las variables `BLUESURF_*` en `env` siguen siendo válidas como override.

## Tools expuestas (solo lectura)

- `mis_proyectos` — proyectos del usuario (id, smallCode, code, name).
- `buscar_mis_tickets(project, include_closed=false)` — tickets asignados al usuario.
- `obtener_ticket(code)` — detalle de un ticket por su código (p. ej. `PROJ-123`).
- `listar_adjuntos(code)` — archivos de la sección Files del ticket (id, name, is_image), sin descargarlos.
- `descargar_adjuntos(code, destino, archivo_id)` — guarda esos archivos en `destino`. Con `archivo_id` descarga solo uno; si no, todos. Devuelve id, name, path, content_type y size.

## Usar el cliente desde Node

```bash
npm install bluesurf-mcp
```

```javascript
import { BlueSurfClient, CredentialsAuth } from "bluesurf-mcp";
```

El paquete es solo ESM. El consumidor entrega las credenciales o la cookie. El paquete no las guarda.
