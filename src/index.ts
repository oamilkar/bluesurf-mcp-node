/** Fachada pública del núcleo. */
export { BlueSurfClient } from "./client.js";
export { AuthError, CookieAuth, CredentialsAuth } from "./auth.js";
export type { AuthProvider } from "./auth.js";
export { DEFAULT_BASE_URL } from "./constants.js";
export { commentsOf } from "./models.js";
export type {
  Attachment,
  CategoriaReporte,
  Comment,
  DownloadedFile,
  EsfuerzoDiario,
  ProyectoReporte,
  ReporteDiario,
  Ticket,
  User,
} from "./models.js";
export type { LineaTiempoInput, RegistrarTiempoInput } from "./client.js";
