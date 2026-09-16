import { accessToken } from '../auth/session';

export const statuses = ['BACKLOG', 'WIP', 'DONE'] as const;
export type Status = (typeof statuses)[number];
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export const postItColors = {
  sky: { label: 'Cielo', value: '#e5ecf2' },
  sage: { label: 'Salvia', value: '#d2e2d7' },
  cork: { label: 'Corcho', value: '#e8dbc7' },
  rose: { label: 'Rosa', value: '#f0d4cd' },
  lilac: { label: 'Lila', value: '#e4dcf0' },
  butter: { label: 'Amarillo', value: '#f5e8b4' },
} as const;
export type PostItColor = keyof typeof postItColors;
export interface User {
  id: number;
  name: string;
  active: boolean;
  color: PostItColor | null;
}
export interface BoardInfo {
  id: number;
  name: string;
}
export interface Task {
  board_id: number;
  id: number;
  title: string;
  description: string;
  assignee_id: number | null;
  assignee: User | null;
  priority: Priority;
  deadline: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  printed_at: string | null;
  url: string;
  comment_count: number;
  last_comment: string | null;
  last_comment_at: string | null;
}
export interface Comment {
  id: number;
  task_id: number;
  body: string;
  created_at: string;
}
export interface Printer {
  id: number;
  name: string;
  location: string;
  active: boolean;
  last_seen: string | null;
}
export interface PrintJob {
  id: number;
  task_id: number | null;
  printer_id: number;
  status: 'PENDING' | 'PRINTING' | 'PRINTED' | 'FAILED';
  error: string | null;
  attempts: number;
  next_attempt_at: string | null;
  created_at: string;
  ticket: { id: number; title: string };
}
export type TaskInput = Pick<
  Task,
  'title' | 'description' | 'assignee_id' | 'priority' | 'deadline' | 'status'
>;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Punto único: toda llamada a la API lleva la sesión, sin tocar componente por componente.
  const token = await accessToken();
  const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      typeof body.detail === 'string'
        ? body.detail
        : response.status === 422
          ? 'Revisa los campos del formulario.'
          : 'No se pudo completar la operación.';
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
export const api = {
  tasks: () => request<Task[]>('/tasks'),
  task: (id: number) => request<Task>(`/tasks/${id}`),
  boards: () => request<BoardInfo[]>('/boards'),
  addBoard: (name: string) =>
    request<BoardInfo>('/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteBoard: (id: number) =>
    request<void>(`/boards/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) }),
  create: (data: TaskInput, print: boolean, printer_id: number, board_id: number) =>
    request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ ...data, print_after_save: print, printer_id, board_id }),
    }),
  update: (id: number, data: Partial<TaskInput>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  move: (id: number, status: Status) =>
    request<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  remove: (id: number) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  print: (id: number, printer_id: number) =>
    request<PrintJob>(`/tasks/${id}/print`, {
      method: 'POST',
      body: JSON.stringify({ printer_id }),
    }),
  comments: (id: number) => request<Comment[]>(`/tasks/${id}/comments`),
  addComment: (id: number, body: string) =>
    request<Comment>(`/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteComment: (id: number) => request<void>(`/comments/${id}`, { method: 'DELETE' }),
  markPrinted: (id: number) => request<Task>(`/tasks/${id}/printed`, { method: 'POST' }),
  users: () => request<User[]>('/users'),
  setUserColor: (id: number, color: PostItColor | null) =>
    request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ color }) }),
  printers: () => request<Printer[]>('/printers'),
  jobs: () => request<PrintJob[]>('/print-jobs'),
  settings: () => request<{ wip_limit: number }>('/settings'),
};
export const taskPaperColor = (task: Task): string | undefined =>
  task.assignee?.color ? postItColors[task.assignee.color].value : undefined;
export const priorityLabels: Record<Priority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};
export const statusLabels: Record<Status, string> = {
  BACKLOG: 'Por hacer',
  WIP: 'En proceso',
  DONE: 'Terminado',
};
export function dateLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(
        new Date(`${value}T12:00:00`),
      )
    : 'Sin fecha';
}
export function utcDate(value: string): Date {
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}
// El sello de impresión es un instante UTC; se muestra en la zona de quien mira.
export const localDateLabel = (value: string): string =>
  utcDate(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
export function isOverdue(task: Task): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Boolean(
    task.deadline && task.status !== 'DONE' && new Date(`${task.deadline}T00:00:00`) < today,
  );
}
export const taskCode = (id: number): string => `TASK-${String(id).padStart(4, '0')}`;
// Instante UTC con hora: en el timeline importa el orden dentro del mismo dia.
export const commentDateLabel = (value: string): string =>
  utcDate(value).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
