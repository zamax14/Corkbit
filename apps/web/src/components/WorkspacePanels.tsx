import { useState, type FormEvent } from 'react';
import { postItColors, type PostItColor, type User } from '../api/client';

function ColorSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: PostItColor | null;
  onChange: (color: PostItColor | null) => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <label className="color-picker">
      <span
        className="color-sample"
        aria-hidden="true"
        style={{ backgroundColor: value ? postItColors[value].value : '#f8f7f4' }}
      />
      <span className="sr-only">{label}</span>
      <select
        value={value || ''}
        disabled={disabled}
        onChange={(event) => onChange((event.target.value || null) as PostItColor | null)}
      >
        <option value="">Por prioridad</option>
        {Object.entries(postItColors).map(([key, color]) => (
          <option value={key} key={key}>
            {color.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MembersPanel({
  users,
  onColor,
}: {
  users: User[];
  onColor: (id: number, color: PostItColor | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function changeColor(id: number, value: PostItColor | null) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onColor(id, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el color.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="members-panel">
      <p className="muted">
        El color de cada miembro se aplica a sus post-its en todos los tableros. La prioridad se
        conserva en la etiqueta.
      </p>
      <p className="muted">
        Los miembros aparecen aquí al iniciar sesión por primera vez. Para sumar a alguien, créale
        una cuenta en Keycloak: no se dan de alta escribiendo un nombre.
      </p>
      {users.length ? (
        <ul className="member-list" aria-label="Miembros del espacio">
          {users.map((user) => (
            <li key={user.id}>
              <span
                className="avatar"
                aria-hidden="true"
                style={{ backgroundColor: user.color ? postItColors[user.color].value : undefined }}
              >
                {user.name.slice(0, 1)}
              </span>
              <span className="member-name">{user.name}</span>
              <ColorSelect
                label={`Color de ${user.name}`}
                value={user.color}
                onChange={(value) => void changeColor(user.id, value)}
                disabled={busy}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="dialog-empty">Nadie ha iniciado sesión todavía.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function BoardForm({
  onSave,
  onCancel,
}: {
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onSave(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el tablero.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="task-form">
      <fieldset disabled={busy}>
        <label>
          Nombre del tablero
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Por ejemplo, Lanzamiento"
          />
        </label>
        <p className="muted">
          Un nuevo tablero de corcho para organizar las tareas de este proyecto.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary" disabled={!name.trim()}>
            {busy ? 'Creando…' : 'Crear tablero'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
