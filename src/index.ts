/** Fachada pública del núcleo de solo lectura. */
export { BlueSurfClient } from "./client.js";
export { AuthError, CookieAuth, CredentialsAuth } from "./auth.js";
export type { AuthProvider } from "./auth.js";
export { DEFAULT_BASE_URL } from "./constants.js";
export { commentsOf } from "./models.js";
export type {
  Attachment,
  Comment,
  DownloadedFile,
  Ticket,
  User,
} from "./models.js";
