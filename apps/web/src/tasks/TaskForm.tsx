import { useState, type FormEvent } from 'react';
import { Printer, Save } from 'lucide-react';
import {
  priorityLabels,
  statuses,
  statusLabels,
  type Printer as PrinterType,
  type Priority,
  type Status,
  type Task,
  type TaskInput,
  type User,
} from '../api/client';

export function TaskForm({
  task,
  status,
  users,
  printers,
  onSave,
  onCancel,
}: {
  task?: Task;
  status: Status;
  users: User[];
  printers: PrinterType[];
  onSave: (data: TaskInput, print: boolean, printer: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [data, setData] = useState<TaskInput>({
    title: task?.title || '',
    description: task?.description || '',
    assignee_id: task?.assignee_id || null,
    deadline: task?.deadline || null,
    priority: task?.priority || 'MEDIUM',
    status: task?.status || status,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printer, setPrinter] = useState(printers.find((p) => p.active)?.id || 1);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const print = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'print';
    try {
      await onSave({ ...data, title: data.title.trim() }, print, printer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="task-form">
      <fieldset disabled={busy}>
        <label>
          ¿Qué hay que hacer?
          <input
            autoFocus
            required
            maxLength={180}
            value={data.title}
            onChange={(e) => setData({ ...data, title: e.target.value })}
            placeholder="Dale un nombre a tu próxima tarea"
          />
        </label>
        <label>
          Descripción <span className="optional">opcional</span>
          <textarea
            rows={3}
            maxLength={10000}
            value={data.description}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            placeholder="Un poco de contexto, sin complicarlo."
          />
        </label>
        <div className="form-grid">
          <label>
            Responsable
            <select
              value={data.assignee_id || ''}
              onChange={(e) =>
                setData({ ...data, assignee_id: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Sin asignar</option>
              {users.map((user) => (
                <option value={user.id} key={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha límite
            <input
              type="date"
              value={data.deadline || ''}
              onChange={(e) => setData({ ...data, deadline: e.target.value || null })}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Prioridad
            <select
              value={data.priority}
              onChange={(e) => setData({ ...data, priority: e.target.value as Priority })}
            >
              {Object.entries(priorityLabels).map(([key, value]) => (
                <option value={key} key={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select
              value={data.status}
              onChange={(e) => setData({ ...data, status: e.target.value as Status })}
            >
              {statuses.map((s) => (
                <option value={s} key={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!task && (
          <label>
            Impresora
            <select value={printer} onChange={(e) => setPrinter(Number(e.target.value))}>
              {printers
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              {!printers.some((p) => p.active) && (
                <option value={1}>Sin impresoras disponibles</option>
              )}
            </select>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className={task ? 'primary' : 'secondary'} value="save">
            <Save size={16} />
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          {!task && (
            <button
              type="submit"
              value="print"
              className="primary"
              disabled={!printers.some((p) => p.active)}
            >
              <Printer size={16} />
              Guardar + imprimir
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
