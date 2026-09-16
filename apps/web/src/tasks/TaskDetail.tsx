import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, Copy, Pencil, Printer, Trash2, UserRound } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { TaskTimeline } from './TaskTimeline';
import {
  dateLabel,
  localDateLabel,
  priorityLabels,
  statuses,
  statusLabels,
  taskCode,
  type Printer as PrinterType,
  type Status,
  type Task,
} from '../api/client';

export function TaskDetail({
  task,
  printers,
  busy,
  onMove,
  onEdit,
  onPrint,
  onPrintHere,
  onDelete,
  onCommented,
}: {
  task: Task;
  printers: PrinterType[];
  busy: boolean;
  onMove: (id: number, status: Status) => void;
  onEdit: () => void;
  onCommented: () => void;
  onPrint: (task: Task, printer: number) => void;
  onPrintHere: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [printer, setPrinter] = useState(printers.find((p) => p.active)?.id || 1);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(task.url);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="task-detail">
      <div className="detail-meta">
        <span className="task-code">{taskCode(task.id)}</span>
        <span className={`priority priority-${task.priority.toLowerCase()}`}>
          <i />
          {priorityLabels[task.priority]}
        </span>
        <span className={task.printed_at ? 'ticket-state printed' : 'ticket-state'}>
          <Printer size={13} />
          {task.printed_at ? `Impresa · ${localDateLabel(task.printed_at)}` : 'Sin imprimir'}
        </span>
      </div>
      <h2>{task.title}</h2>
      <p className="detail-description">
        {task.description || 'Sin descripción. A veces, el título lo dice todo.'}
      </p>
      <div className="detail-facts">
        <span>
          <UserRound size={17} />
          {task.assignee?.name || 'Sin asignar'}
        </span>
        <span>
          <CalendarDays size={17} />
          {dateLabel(task.deadline)}
          {task.deadline && ` ${task.deadline.slice(0, 4)}`}
        </span>
      </div>
      <span className="field-caption">MOVER TAREA</span>
      <div className="status-actions">
        {statuses.map((s) => (
          <button
            key={s}
            disabled={busy}
            className={task.status === s ? 'status-option selected' : 'status-option'}
            aria-pressed={task.status === s}
            onClick={() => onMove(task.id, s)}
          >
            {task.status === s && <Check size={15} />}
            <span>{statusLabels[s]}</span>
          </button>
        ))}
      </div>
      <TaskTimeline taskId={task.id} onChanged={onCommented} />
      <div className="qr-panel">
        <QRCodeSVG value={task.url} size={96} marginSize={2} title={`Abrir ${taskCode(task.id)}`} />
        <div>
          <h3>Del tablero al papel.</h3>
          <p>Escanea el QR para abrir y mover esta tarea desde tu teléfono.</p>
          <button className="text-button" onClick={() => void copy()}>
            <Copy size={14} />
            {copied ? 'Enlace copiado' : 'Copiar enlace'}
          </button>
          {copyError && <a href={task.url}>Abrir enlace de la tarea</a>}
        </div>
      </div>
      <label className="printer-select">
        Impresora
        <select value={printer} onChange={(e) => setPrinter(Number(e.target.value))}>
          {printers
            .filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <div className="detail-actions">
        <button className="primary" onClick={onPrintHere}>
          <Printer size={17} />
          Imprimir aquí
        </button>
        <button
          className="secondary"
          disabled={busy || !printers.some((p) => p.active)}
          onClick={() => onPrint(task, printer)}
        >
          Reimprimir
        </button>
        <button className="secondary" disabled={busy} onClick={onEdit}>
          <Pencil size={16} />
          Editar
        </button>
        <button
          className="icon-button danger"
          disabled={busy}
          aria-label="Eliminar tarea"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={18} />
        </button>
      </div>
      {createPortal(
        <article className="ticket-sheet" aria-hidden="true">
          <p className="ticket-line">
            {taskCode(task.id)} · {priorityLabels[task.priority]}
          </p>
          <hr />
          <h1>{task.title}</h1>
          <p className="ticket-label">Responsable</p>
          <p>{task.assignee?.name || 'Sin asignar'}</p>
          <p className="ticket-label">Fecha límite</p>
          <p>{task.deadline || 'Sin fecha'}</p>
          <p className="ticket-label">Estado</p>
          <p>{statusLabels[task.status]}</p>
          <hr />
          <QRCodeSVG value={task.url} size={132} marginSize={0} />
          <p className="ticket-line">{taskCode(task.id)}</p>
          <p className="ticket-brand">crokbit.</p>
        </article>,
        document.body,
      )}
      {confirming && (
        <div className="delete-confirm" role="alert">
          <p>
            ¿Eliminar esta tarea? Esta acción no se puede deshacer. Los tickets ya enviados se
            conservan.
          </p>
          <button className="danger-button" disabled={busy} onClick={onDelete}>
            Sí, eliminar tarea
          </button>
          <button className="text-button" onClick={() => setConfirming(false)}>
            Conservar tarea
          </button>
        </div>
      )}
    </div>
  );
}
