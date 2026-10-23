/** Modelos de las entidades de BlueSurf.

Los campos reflejan la forma observada en la API. Cada modelo conserva `raw`
con el payload original. El JSON de un ticket coincide con `dataclasses.asdict`
del cliente Python: snake_case, usuarios anidados y `raw`. Los comentarios no
salen como campo propio; siguen dentro de `raw`.
*/

export interface User {
  id: string;
  blue_tag: string | null;
  full_name: string | null;
  email: string | null;
  raw: Record<string, unknown>;
}

export interface Comment {
  id: string;
  author: string | null;
  body: string | null;
  created_at: string | null;
  raw: Record<string, unknown>;
}

export interface Attachment {
  id: string;
  work_item_id: string;
  name: string | null;
  is_image: boolean;
  raw: Record<string, unknown>;
}

export interface DownloadedFile {
  id: string;
  name: string;
  content_type: string | null;
  content: Buffer;
  path: string | null;
}

export interface Ticket {
  id: string;
  code: string | null;
  name: string | null;
  description: string | null;
  type_name: string | null;
  status_name: string | null;
  status_is_final: boolean;
  priority_name: string | null;
  project_id: string | null;
  project_name: string | null;
  current_sprint_name: string | null;
  assignee: User | null;
  reporter: User | null;
  estimated_effort: number | null;
  total_hours: number | null;
  created_at: string | null;
  initiated_at: string | null;
  finished_at: string | null;
  raw: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asId(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Primer string no vacío. Equivale al `or` de los campos opcionales de la API. */
function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export function userFromCurrentUser(data: Record<string, unknown>): User {
  return {
    id: asId(data.id),
    blue_tag: asString(data.blueTag),
    full_name: asString(data.fullName),
    email: asString(data.email),
    raw: data,
  };
}

function userFromPrefixed(
  data: Record<string, unknown>,
  prefix: string,
): User | null {
  const userId = data[`${prefix}Id`];
  if (!userId) return null;
  return {
    id: asId(userId),
    blue_tag: asString(data[`${prefix}BlueTag`]),
    full_name: asString(data[`${prefix}FullName`]),
    email: asString(data[`${prefix}Email`]),
    raw: {},
  };
}

export function userToDict(user: User): Record<string, unknown> {
  return {
    id: user.id,
    blue_tag: user.blue_tag,
    full_name: user.full_name,
    email: user.email,
    raw: user.raw,
  };
}

export function commentFromJson(data: Record<string, unknown>): Comment {
  return {
    id: asId(data.id),
    author: firstString(data.createdByFullName, data.createdByBlueTag),
    body: firstString(data.comment, data.body, data.text),
    created_at: firstString(data.createdAt, data.createdDateTime),
    raw: data,
  };
}

export function commentsOf(ticket: Ticket): Comment[] {
  const raw = ticket.raw.comments;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map(commentFromJson);
}

export function attachmentFromJson(data: Record<string, unknown>): Attachment {
  return {
    id: asId(data.id),
    work_item_id: asId(data.workItemId),
    name: asString(data.name),
    is_image: Boolean(data.isImage ?? false),
    raw: data,
  };
}

export function ticketFromJson(data: Record<string, unknown>): Ticket {
  return {
    id: asId(data.id),
    code: asString(data.code),
    name: asString(data.name),
    description: asString(data.description),
    type_name: firstString(data.typeDisplayName, data.typeName),
    status_name: asString(data.statusName),
    status_is_final: Boolean(data.statusIsFinal ?? false),
    priority_name: firstString(data.priorityDisplayName, data.priorityName),
    project_id: asString(data.projectId),
    project_name: asString(data.projectName),
    current_sprint_name: asString(data.currentSprintName),
    assignee: userFromPrefixed(data, "assignedTo"),
    reporter: userFromPrefixed(data, "reportedBy"),
    estimated_effort: asNumber(data.estimatedEffort),
    total_hours: asNumber(data.totalHours),
    created_at: asString(data.createdAt),
    initiated_at: asString(data.initiatedAt),
    finished_at: asString(data.finishedAt),
    raw: data,
  };
}

/** Misma forma que `dataclasses.asdict` del modelo Python. */
export function ticketToDict(ticket: Ticket): Record<string, unknown> {
  return {
    id: ticket.id,
    code: ticket.code,
    name: ticket.name,
    description: ticket.description,
    type_name: ticket.type_name,
    status_name: ticket.status_name,
    status_is_final: ticket.status_is_final,
    priority_name: ticket.priority_name,
    project_id: ticket.project_id,
    project_name: ticket.project_name,
    current_sprint_name: ticket.current_sprint_name,
    assignee: ticket.assignee ? userToDict(ticket.assignee) : null,
    reporter: ticket.reporter ? userToDict(ticket.reporter) : null,
    estimated_effort: ticket.estimated_effort,
    total_hours: ticket.total_hours,
    created_at: ticket.created_at,
    initiated_at: ticket.initiated_at,
    finished_at: ticket.finished_at,
    raw: ticket.raw,
  };
}
