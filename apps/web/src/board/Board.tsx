import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { ArrowRight, Check, Circle, Plus } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { statuses, statusLabels, type Status, type Task } from '../api/client';
import { TaskCard } from './TaskCard';

const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
  event.preventDefault();
  const current = statuses.indexOf(
    (context.over?.id || context.active?.data.current?.status) as Status,
  );
  const next = Math.max(
    0,
    Math.min(2, current + (['ArrowRight', 'ArrowDown'].includes(event.code) ? 1 : -1)),
  );
  const rect = context.droppableRects.get(statuses[next]);
  const active = context.collisionRect;
  return rect && active
    ? {
        x: currentCoordinates.x + rect.left + rect.width / 2 - active.left - active.width / 2,
        y: currentCoordinates.y + rect.top + rect.height / 2 - active.top - active.height / 2,
      }
    : undefined;
};
function Column({
  status,
  tasks,
  limit,
  onNew,
  onOpen,
  onPrint,
  busy,
}: {
  status: Status;
  tasks: Task[];
  limit: number;
  onNew: (status: Status) => void;
  onOpen: (task: Task) => void;
  onPrint: (task: Task) => void;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`column column-${status.toLowerCase()} ${isOver ? 'drop-over' : ''}`}
      aria-label={statusLabels[status]}
    >
      <span className="twine twine-divider" aria-hidden="true">
        <i />
        <i />
      </span>
      <div className="column-label">
        <header className="column-heading">
          <div className="column-title">
            <span className="column-symbol">
              {status === 'DONE' ? (
                <Check size={16} />
              ) : status === 'WIP' ? (
                <ArrowRight size={16} />
              ) : (
                <Circle size={12} />
              )}
            </span>
            <h2>{statusLabels[status]}</h2>
            <span
              className={`count ${status === 'WIP' && tasks.length > limit ? 'over-limit' : ''}`}
            >
              {tasks.length}
              {status === 'WIP' && <span> / {limit}</span>}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label={`Nueva tarea en ${statusLabels[status]}`}
            onClick={() => onNew(status)}
          >
            <Plus size={19} />
          </button>
        </header>
        <p className="column-subtitle">
          {status === 'BACKLOG'
            ? 'Las ideas empiezan aquí.'
            : status === 'WIP'
              ? 'Una cosa a la vez.'
              : 'Pequeñas grandes victorias.'}
        </p>
      </div>
      <span className="twine twine-heading" aria-hidden="true">
        <i />
        <i />
      </span>
      {status === 'WIP' && tasks.length > limit && (
        <p className="wip-warning" role="status">
          Límite WIP alcanzado. Termina algo antes de empezar más.
        </p>
      )}
      <div className="notes">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} onPrint={onPrint} busy={busy} />
        ))}
        {!tasks.length && (
          <div className="empty-column">
            <span>{status === 'DONE' ? '✓' : status === 'WIP' ? '→' : '✧'}</span>
            <p>
              {status === 'DONE'
                ? 'Aquí van tus logros'
                : status === 'WIP'
                  ? 'Espacio para enfocarte'
                  : 'Una idea, una nueva tarea'}
            </p>
            <small>
              {status === 'DONE'
                ? 'Cada tarea terminada cuenta.'
                : 'Arrastra una nota o crea una nueva.'}
            </small>
          </div>
        )}
      </div>
      <button className="add-note" onClick={() => onNew(status)}>
        <Plus size={16} />
        Añadir tarea
      </button>
    </section>
  );
}
export function Board({
  tasks,
  limit,
  onMove,
  onNew,
  onOpen,
  onPrint,
  busy,
}: {
  tasks: Task[];
  limit: number;
  onMove: (id: number, status: Status) => void;
  onNew: (status: Status) => void;
  onOpen: (task: Task) => void;
  onPrint: (task: Task) => void;
  busy: boolean;
}) {
  const [active, setActive] = useState<Task | null>(null);
  const [descriptions, setDescriptions] = useState(true);
  const boardRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, DOMRect>());
  const [order, setOrder] = useState<number[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('corkbit.note-order') || '[]');
      return Array.isArray(saved) ? saved.filter((id): id is number => Number.isInteger(id)) : [];
    } catch {
      return [];
    }
  });
  const orderedTasks = [...tasks].sort((a, b) => {
    const rank = (id: number) => (order.includes(id) ? order.indexOf(id) : -1);
    return rank(a.id) - rank(b.id);
  });
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    boardRef.current?.querySelectorAll<HTMLElement>('[data-task-id]').forEach((node) => {
      const id = node.dataset.taskId!;
      const rect = node.getBoundingClientRect();
      const previous = positions.current.get(id);
      next.set(id, rect);
      if (previous && !active && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const x = previous.left - rect.left;
        const y = previous.top - rect.top;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) {
          node.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], {
            duration: 380,
            easing: 'cubic-bezier(.22, 1, .36, 1)',
          });
        }
      }
    });
    positions.current = next;
  }, [tasks, order, active, descriptions]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  function end(event: DragEndEvent) {
    setActive(null);
    if (!event.over || !statuses.includes(event.over.id as Status)) return;
    const id = Number(event.active.id);
    const status = event.over.id as Status;
    const rect = event.active.rect.current.translated;
    const y = rect ? rect.top + rect.height / 2 : Infinity;
    const target = orderedTasks.filter((task) => task.status === status && task.id !== id);
    const before = target.find((task) => {
      const node = boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${task.id}"]`);
      const bounds = node?.getBoundingClientRect();
      return bounds && y < bounds.top + bounds.height / 2;
    });
    const next = orderedTasks.map((task) => task.id).filter((taskId) => taskId !== id);
    const index = before
      ? next.indexOf(before.id)
      : target.length
        ? next.indexOf(target[target.length - 1].id) + 1
        : next.length;
    next.splice(index, 0, id);
    setOrder(next);
    try {
      localStorage.setItem('corkbit.note-order', JSON.stringify(next));
    } catch {
      /* Storage may be disabled. */
    }
    onMove(id, status);
  }
  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) => setActive(tasks.find((t) => t.id === event.active.id) || null)}
      onDragEnd={end}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Pulsa espacio para tomar la tarea, flechas para cambiar de columna y espacio para soltar. Escape cancela.',
        },
        announcements: {
          onDragStart: () => 'Tarea seleccionada. Usa las flechas para cambiar de columna.',
          onDragOver: ({ over }) =>
            over ? `Destino: ${statusLabels[over.id as Status]}` : 'Fuera del tablero',
          onDragEnd: ({ over }) =>
            over ? `Tarea soltada en ${statusLabels[over.id as Status]}` : 'Movimiento cancelado',
          onDragCancel: () => 'Movimiento cancelado',
        },
      }}
    >
      <label className="note-view-switch">
        <input
          type="checkbox"
          role="switch"
          checked={descriptions}
          disabled={Boolean(active)}
          onChange={(event) => setDescriptions(event.target.checked)}
        />
        <span className="switch-track" aria-hidden="true" />
        Mostrar descripciones
      </label>
      <div ref={boardRef} className={`board ${descriptions ? '' : 'simple-notes'}`}>
        {statuses.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={orderedTasks.filter((t) => t.status === status)}
            limit={limit}
            onNew={onNew}
            onOpen={onOpen}
            onPrint={onPrint}
            busy={busy}
          />
        ))}
      </div>
      <DragOverlay adjustScale={false} dropAnimation={null}>
        {active && (
          <div className={`drag-card ${descriptions ? '' : 'simple-notes'}`}>
            <TaskCard task={active} onOpen={onOpen} onPrint={onPrint} busy={busy} preview />
            <img className="drag-preview-hand" src="/hand.png" alt="" />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
