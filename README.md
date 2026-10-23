# bluesurf-mcp (Node.js)

Servidor MCP local de **solo lectura** para que Cursor u otros agentes lean
tickets de **BlueSurf**. Es el port a Node.js del paquete Python
[`bluesurf-mcp`](../bluesurf-mcp): mismas tools, mismas variables de entorno y
el mismo CLI (`login`, `logout`, y sin argumentos el servidor por stdio).

**Solo lectura por diseño:** no hay operaciones de escritura. El kanban se
consulta con un POST de filtro.

Hace falta **Node.js 20 o superior**. El paquete Python no se modifica y sigue
siendo el distro de PyPI.

## Instalación

Desde esta carpeta:

```bash
npm install
npm run build
node dist/bin.js --help
```

`npm test` compila y corre la suite (sin red).

## Guardar credenciales (`login` / `logout`)

La contraseña no va en `mcp.json`. Una vez, en una terminal:

```bash
node dist/bin.js login
```

Pide usuario y contraseña, valida contra BlueSurf y guarda la contraseña en el
almacén del sistema (Credential Manager en Windows, Keychain en macOS, Secret
Service en Linux). El username queda en un JSON local, sin la contraseña.

Este almacén es propio del port. El servicio se llama `bluesurf-mcp-node` y el
usuario vive en:

- Windows: `%LOCALAPPDATA%\bluesurf-mcp-node\config.json`
- macOS / Linux: `~/.config/bluesurf-mcp-node/config.json` (o `XDG_CONFIG_HOME`)

Un `login` hecho con el paquete Python sigue en su almacén. Aquí hay que entrar
con este binario.

```bash
node dist/bin.js logout
```

borra lo guardado por este port.

## Configuración (variables de entorno)

El entorno **gana** sobre lo guardado con `login`.

Claves canónicas `BLUESURF_*`; se aceptan `SURF_*` como fallback.

- `BLUESURF_BASE_URL` — URL base (opcional; default `https://surf.bluepeople.com`).
- `BLUESURF_COOKIE` — cookie de sesión ya válida → usa `CookieAuth`.
- `BLUESURF_USERNAME` + `BLUESURF_PASSWORD` — credenciales → usa `CredentialsAuth`.

Precedencia: cookie en env → usuario/contraseña en env → `node dist/bin.js login`.

El núcleo no persiste secretos. La cookie de sesión vive en memoria mientras
corre el proceso.

## Correr el servidor

```bash
node dist/bin.js
```

Se comunica por **stdio**. Sin argumentos no pide contraseña: usa el entorno o
las credenciales de `login`.

## Registrar el MCP en Cursor

`command` es `node` y `args` apunta al `dist/bin.js` compilado. Así no choca
con el ejecutable `bluesurf-mcp` del paquete Python si también está en el PATH.

```json
{
  "mcpServers": {
    "bluesurf": {
      "command": "node",
      "args": ["D:\\ruta\\completa\\bluesurf-mcp-node\\dist\\bin.js"]
    }
  }
}
```

En el JSON de Windows las barras invertidas van dobles. Las variables
`BLUESURF_*` en `env` siguen siendo válidas como override.

## Tools expuestas (solo lectura)

- `mis_proyectos` — proyectos del usuario (id, smallCode, code, name).
- `buscar_mis_tickets(project, include_closed=false)` — tickets asignados al usuario.
- `obtener_ticket(code)` — detalle de un ticket por su código (p. ej. `PROJ-123`).
- `listar_adjuntos(code)` — archivos de la sección Files del ticket (id, name, is_image), sin descargarlos.
- `descargar_adjuntos(code, destino, archivo_id)` — guarda esos archivos en `destino`. Con `archivo_id` descarga solo uno; si no, todos. Devuelve id, name, path, content_type y size.

## Usar el cliente desde Node

Tras `npm run build`:

```javascript
import { BlueSurfClient, CredentialsAuth } from "bluesurf-mcp";
```

El consumidor entrega las credenciales o la cookie. El paquete no las guarda.
