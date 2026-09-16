import { useDraggable } from '@dnd-kit/core';
import type { CSSProperties } from 'react';
import { CalendarDays, Check, GripVertical, MessageSquare, Printer } from 'lucide-react';
import { commentDateLabel, dateLabel, isOverdue, localDateLabel, priorityLabels, taskCode, taskPaperColor, type Task } from '../api/client';

export function TaskCard({
  task,
  onOpen,
  onPrint,
  busy,
  preview = false,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onPrint: (task: Task) => void;
  busy: boolean;
  preview?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: preview ? `preview-${task.id}` : task.id,
    data: { status: task.status },
    disabled: busy || preview,
  });
  const initials =
    task.assignee?.name
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('') || '—';
  return (
    <article
      ref={preview ? undefined : setNodeRef}
      data-task-id={preview ? undefined : task.id}
      aria-hidden={preview || undefined}
      inert={preview || undefined}
      style={{ '--rotation': `${[-1.3, 0.7, -0.4, 1.1][task.id % 4]}deg`, backgroundColor: taskPaperColor(task) } as CSSProperties}
      className={`note note-${task.priority.toLowerCase()} ${isDragging ? 'dragging' : ''} ${task.status === 'DONE' ? 'finished' : ''}`}
    >
      <div className="note-top">
        <span className="task-code">{taskCode(task.id)}</span>
        {task.comment_count > 0 && task.last_comment_at && (
          <span
            className="comment-mark"
            title={`Último comentario: ${commentDateLabel(task.last_comment_at)}`}
          >
            <MessageSquare size={12} />
            {task.comment_count}
          </span>
        )}
      </div>
      <button className="note-body" onClick={() => onOpen(task)}>
        <h3>{task.title}</h3>
        {task.description && <p>{task.description}</p>}
      </button>
      <div className="note-priority">
        <span className={`priority priority-${task.priority.toLowerCase()}`}>
          <i />
          {priorityLabels[task.priority]}
        </span>
        {task.status === 'DONE' && (
          <span className="done-check">
            <Check size={13} />
            Listo
          </span>
        )}
        {task.printed_at && (
          <span className="printed-mark" title={`Impresa el ${localDateLabel(task.printed_at)}`}>
            <Printer size={12} />
            Impresa
          </span>
        )}
      </div>
      <div className="note-bottom">
        <span className="assignee" title={task.assignee?.name || 'Sin asignar'}>
          <span className="avatar">{initials}</span>
          <span>{task.assignee?.name || 'Sin asignar'}</span>
        </span>
        <button
          disabled={busy}
          className="note-print"
          aria-label={`Imprimir ${task.title}`}
          onClick={() => onPrint(task)}
        >
          <Printer size={16} />
        </button>
      </div>
      <div className={`note-date ${isOverdue(task) ? 'overdue' : ''}`}>
        <CalendarDays size={13} />
        {dateLabel(task.deadline)}
        {isOverdue(task) && <span>· Vencida</span>}
      </div>
      <button
        className="drag-handle drag-corner"
        {...listeners}
        {...attributes}
        aria-label={`Mover ${task.title}`}
      >
        <GripVertical size={18} />
      </button>
    </article>
  );
}
