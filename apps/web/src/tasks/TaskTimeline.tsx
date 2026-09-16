import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import { api, commentDateLabel, type Comment } from '../api/client';

// El timeline carga sus propios comentarios: la tarjeta del tablero solo necesita el contador,
// que ya viaja en la tarea. onChanged avisa para refrescar ese contador tras escribir o borrar.
export function TaskTimeline({ taskId, onChanged }: { taskId: number; onChanged: () => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setComments(await api.comments(taskId));
      setError('');
    } catch {
      setError('No se pudo cargar el historial.');
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      setComments([await api.addComment(taskId, body), ...comments]);
      setDraft('');
      setError('');
      onChanged();
    } catch {
      setError('No se pudo guardar el comentario.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await api.deleteComment(id);
      setComments(comments.filter((comment) => comment.id !== id));
      onChanged();
    } catch {
      setError('No se pudo borrar el comentario.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="timeline">
      <span className="field-caption">
        HISTORIAL
        {comments.length > 0 && ` · ${comments.length}`}
      </span>
      <form className="timeline-form" onSubmit={(event) => void add(event)}>
        <textarea
          value={draft}
          rows={2}
          maxLength={2000}
          placeholder="¿En qué avanzó esta tarea?"
          aria-label="Nuevo comentario"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="secondary" type="submit" disabled={busy || !draft.trim()}>
          Comentar
        </button>
      </form>
      {error && <p className="timeline-error">{error}</p>}
      {comments.length === 0 ? (
        <p className="timeline-empty">
          <MessageSquare size={15} />
          Sin comentarios todavía. Aquí queda lo que avanza aunque la tarea no se mueva.
        </p>
      ) : (
        <ol className="timeline-list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <time dateTime={comment.created_at}>{commentDateLabel(comment.created_at)}</time>
              <p>{comment.body}</p>
              <button
                className="icon-button danger"
                disabled={busy}
                aria-label={`Borrar comentario del ${commentDateLabel(comment.created_at)}`}
                onClick={() => void remove(comment.id)}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
