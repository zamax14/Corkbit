import { useState } from 'react';
import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import { statuses, statusLabels, taskPaperColor, type BoardInfo, type Task } from '../api/client';
import { Dialog } from '../components/Dialog';

export function BoardGallery({
  boards,
  tasks,
  onOpen,
  onNew,
  onDelete,
  disabled,
}: {
  boards: BoardInfo[];
  tasks: Task[];
  onOpen: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => Promise<void>;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState<BoardInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    if (!confirming || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await onDelete(confirming.id);
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el tablero.');
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <div className="gallery-grid">
        {boards.map((board) => {
          const items = tasks.filter((task) => task.board_id === board.id);
          return (
            <article className="board-preview" key={board.id}>
              <button
                className="preview-open"
                onClick={() => onOpen(board.id)}
                aria-label={`Abrir tablero ${board.name}`}
                disabled={disabled}
              >
                <span className="mini-board" aria-hidden="true">
                  {statuses.map((status) => (
                    <span className="mini-column" key={status}>
                      <span className="mini-label">{statusLabels[status]}</span>
                      {items
                        .filter((task) => task.status === status)
                        .slice(0, 3)
                        .map((task) => (
                          <span
                            key={task.id}
                            className={`mini-note note-${task.priority.toLowerCase()}`}
                            style={{ backgroundColor: taskPaperColor(task) }}
                          >
                            {task.title}
                          </span>
                        ))}
                    </span>
                  ))}
                </span>
                <span className="preview-title">
                  <strong>{board.name}</strong>
                  <ArrowUpRight size={18} />
                </span>
              </button>
              <div className="preview-footer">
                <span>
                  {items.length} tareas · {items.filter((task) => task.status === 'DONE').length}{' '}
                  terminadas
                </span>
                <button
                  className="icon-button danger"
                  aria-label={`Eliminar tablero ${board.name}`}
                  disabled={disabled}
                  onClick={() => {
                    setError('');
                    setConfirming(board);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          );
        })}
        <button className="new-board-preview" onClick={onNew} disabled={disabled}>
          <Plus size={28} />
          <strong>Nuevo tablero</strong>
          <span>Un espacio para tu próximo proyecto.</span>
        </button>
      </div>
      {confirming && (
        <Dialog
          title="Eliminar tablero"
          onClose={() => {
            if (!deleting) setConfirming(null);
          }}
        >
          <div className="task-detail">
            <p>
              Vas a eliminar <strong>{confirming.name}</strong> y sus{' '}
              <strong>
                {tasks.filter((task) => task.board_id === confirming.id).length} tareas
              </strong>
              .
            </p>
            <p className="muted delete-explanation">
              Esta acción no se puede deshacer. Sus QR dejarán de abrir las tareas. Los miembros y
              los demás tableros se conservan.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                autoFocus
                className="secondary"
                disabled={deleting}
                onClick={() => setConfirming(null)}
              >
                Cancelar
              </button>
              <button className="danger-button" disabled={deleting} onClick={() => void remove()}>
                {deleting ? 'Eliminando…' : 'Sí, eliminar tablero'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
