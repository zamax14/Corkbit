import { useCallback, useEffect, useRef, useState } from 'react';
import { currentName, signOut } from './auth/session';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleHelp,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  taskCode,
  utcDate,
  type BoardInfo,
  type PrintJob,
  type Printer as PrinterType,
  type Status,
  type Task,
  type TaskInput,
  type User,
} from './api/client';
import { Board } from './board/Board';
import { BoardGallery } from './board/BoardGallery';
import { Dialog } from './components/Dialog';
import { BoardForm, MembersPanel } from './components/WorkspacePanels';
import { TaskForm } from './tasks/TaskForm';
import { TaskDetail } from './tasks/TaskDetail';

type Modal =
  | { kind: 'new'; status: Status }
  | { kind: 'detail' | 'edit'; id: number }
  | { kind: 'prints' | 'help' | 'members' | 'board' }
  | null;
const routeId = /^\/t\/(\d+)\/?$/.exec(window.location.pathname)?.[1];
const mobileId = routeId ? Number(routeId) : null;
export default function App() {
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [boardId, setBoardId] = useState<number | null>(
    Number(new URLSearchParams(window.location.search).get('board')) || null,
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [missing, setMissing] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const fetchId = useRef(0);
  const notify = (text: string, error = false) => setNotice({ text, error });
  const reload = useCallback(async () => {
    const requestEpoch = epoch.current;
    const id = ++fetchId.current;
    try {
      const [newTasks, newUsers, newPrinters, newJobs, config, newBoards] = await Promise.all([
        mobileId ? api.task(mobileId).then((t) => [t]) : api.tasks(),
        api.users(),
        api.printers(),
        api.jobs(),
        api.settings(),
        api.boards(),
      ]);
      if (
        !mounted.current ||
        id !== fetchId.current ||
        mutation.current ||
        requestEpoch !== epoch.current
      )
        return;
      setTasks(newTasks);
      setBoards(newBoards);
      setUsers(newUsers);
      setPrinters(newPrinters);
      setJobs(newJobs);
      setLimit(config.wip_limit);
      setLoadError('');
      setMissing(false);
    } catch (e) {
      if (!mounted.current || id !== fetchId.current) return;
      setMissing(e instanceof ApiError && e.status === 404 && Boolean(mobileId));
      setLoadError(e instanceof Error ? e.message : 'No se pudo conectar con el servidor.');
    } finally {
      if (mounted.current && id === fetchId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const timer = window.setInterval(() => {
      if (!document.hidden && !mutation.current) void reload();
    }, 10000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [reload]);
  useEffect(() => {
    const onPopState = () => setBoardId(Number(new URLSearchParams(window.location.search).get('board')) || null);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  async function mutate(action: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    epoch.current++;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'No se pudo completar la operación.', true);
    } finally {
      epoch.current++;
      mutation.current = false;
      setBusy(false);
      void reload();
    }
  }
  function replace(task: Task) {
    setTasks((current) =>
      current.some((t) => t.id === task.id)
        ? current.map((t) => (t.id === task.id ? task : t))
        : [task, ...current],
    );
  }
  function move(id: number, status: Status) {
    const old = tasks.find((t) => t.id === id);
    if (!old || old.status === status) return;
    void mutate(async () => {
      const task = await api.move(id, status);
      replace(task);
      const excess =
        status === 'WIP' &&
        tasks.filter((t) => t.board_id === old.board_id && t.status === 'WIP').length >= limit;
      notify(
        excess
          ? 'Tarea movida. Límite WIP alcanzado: termina algo antes de empezar más.'
          : 'Tarea movida. Un paso más.',
      );
    });
  }
  function print(task: Task, printer = printers.find((p) => p.active)?.id || 1) {
    void mutate(async () => {
      const job = await api.print(task.id, printer);
      setJobs((current) => [job, ...current]);
      notify(`${taskCode(task.id)} en la cola de impresión.`);
    });
  }
  function printHere(task: Task) {
    // El diálogo del navegador no dice si salió papel; el sello es informativo y se puede repetir.
    window.print();
    void mutate(async () => {
      replace(await api.markPrinted(task.id));
      notify(`${taskCode(task.id)} marcada como impresa.`);
    });
  }
  async function save(data: TaskInput, shouldPrint: boolean, printer: number) {
    if (mutation.current) throw new Error('Espera a que termine la operación actual.');
    if (modal?.kind !== 'edit' && !activeBoardId) throw new Error('Selecciona un tablero para crear la tarea.');
    mutation.current = true;
    epoch.current++;
    setBusy(true);
    try {
      const task =
        modal?.kind === 'edit'
          ? await api.update(modal.id, data)
          : await api.create(data, shouldPrint, printer, activeBoardId!);
      replace(task);
      setModal(mobileId ? null : { kind: 'detail', id: task.id });
      notify(
        shouldPrint
          ? 'Tarea guardada y enviada a la cola de impresión.'
          : 'Tarea guardada. Todo en su lugar.',
      );
    } finally {
      mutation.current = false;
      epoch.current++;
      setBusy(false);
      void reload();
    }
  }
  function remove(task: Task) {
    void mutate(async () => {
      await api.remove(task.id);
      setTasks((current) => current.filter((t) => t.id !== task.id));
      setModal(null);
      if (mobileId) {
        setMissing(true);
      }
      notify('Tarea eliminada.');
    });
  }
  function selectBoard(id: number | null) {
    setBoardId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('board', String(id));
    else url.searchParams.delete('board');
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
  }
  function rememberUser(user: User) {
    epoch.current++;
    setUsers((current) => [...current.filter((item) => item.id !== user.id), user]);
    setTasks((current) => current.map((task) => task.assignee_id === user.id ? { ...task, assignee: user } : task));
  }
  async function changeMember(action: () => Promise<User>) {
    if (mutation.current) throw new Error('Espera a que termine la operación actual.');
    mutation.current = true;
    epoch.current++;
    setBusy(true);
    try {
      rememberUser(await action());
    } finally {
      mutation.current = false;
      epoch.current++;
      setBusy(false);
      void reload();
    }
  }
  async function deleteBoard(id: number) {
    if (mutation.current) throw new Error('Espera a que termine la operación actual.');
    mutation.current = true;
    epoch.current++;
    setBusy(true);
    try {
      await api.deleteBoard(id);
      setBoards((current) => current.filter((board) => board.id !== id));
      setTasks((current) => current.filter((task) => task.board_id !== id));
      if (boardId === id) selectBoard(null);
      notify('Tablero eliminado.');
    } finally {
      mutation.current = false;
      epoch.current++;
      setBusy(false);
      void reload();
    }
  }
  async function createBoard(name: string) {
    if (mutation.current) throw new Error('Espera a que termine la operación actual.');
    mutation.current = true;
    epoch.current++;
    setBusy(true);
    try {
      const board = await api.addBoard(name);
      setBoards((current) => [...current, board]);
      selectBoard(board.id);
      setModal(null);
      notify('Tablero creado.');
    } finally {
      mutation.current = false;
      epoch.current++;
      setBusy(false);
      void reload();
    }
  }
  const activeBoardId = boards.some((board) => board.id === boardId) ? boardId : null;
  const showGallery = !mobileId && !activeBoardId;
  const boardTasks = tasks.filter((task) => task.board_id === activeBoardId);
  const selected =
    modal && (modal.kind === 'detail' || modal.kind === 'edit')
      ? tasks.find((t) => t.id === modal.id)
      : undefined;
  const mobileTask = tasks.find((t) => t.id === mobileId);
  const activePrinter = printers.find((p) => p.active);
  const online = Boolean(
    activePrinter?.last_seen && Date.now() - utcDate(activePrinter.last_seen).getTime() < 60000,
  );
  const pending = jobs.filter((j) => j.status === 'PENDING' || j.status === 'PRINTING').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;
  const done = boardTasks.filter((t) => t.status === 'DONE').length;
  const close = () => {
    if (!busy) setModal(null);
  };
  const detail = (task: Task) => (
    <TaskDetail
      task={task}
      printers={printers}
      busy={busy}
      onMove={move}
      onEdit={() => setModal({ kind: 'edit', id: task.id })}
      onPrint={print}
      onPrintHere={() => printHere(task)}
      onDelete={() => remove(task)}
      onCommented={() => void reload()}
    />
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="/" className="brand">
          Corkbit
          <span className="brand-mark" aria-hidden="true" />
        </a>
        <span className="header-divider" />
        <span className="workspace-name">Mi espacio de trabajo</span>
        <div className="header-right">
          <span className="local-badge">Simple. Flexible. En el mundo real.</span>
          <button
            className="icon-button"
            aria-label="Cómo funciona"
            onClick={() => setModal({ kind: 'help' })}
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="secondary members-button"
            onClick={() => setModal({ kind: 'members' })}
          >
            <Users size={17} /> Miembros <span>{users.length}</span>
          </button>
          {currentName() && (
            <button
              className="icon-button"
              aria-label={`Cerrar sesión de ${currentName()}`}
              title={currentName()}
              onClick={signOut}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      <main className={mobileId ? 'main-content mobile-page' : 'main-content'}>
        {mobileId ? (
          <a href={mobileTask ? `/?board=${mobileTask.board_id}` : '/'} className="back-link">
            <ArrowLeft size={17} />
            Volver al tablero
          </a>
        ) : (
          <>
            <div className="page-intro">
              <div>
                <div className="eyebrow intro-eyebrow">
                  <span />
                  IDEAS EN ACCIÓN
                </div>
                <h1>{showGallery ? 'Tus tableros.' : <>Tu trabajo, <em>a la vista.</em></>}</h1>
                <p>{showGallery ? 'Cada proyecto tiene su espacio. Elige dónde seguir.' : 'De una idea a una nota. De una nota a algo hecho.'}</p>
              </div>
              <button
                className="primary new-task"
                disabled={loading || busy || Boolean(loadError)}
                onClick={() => setModal(showGallery ? { kind: 'board' } : { kind: 'new', status: 'BACKLOG' })}
              >
                <Plus size={19} />
                {showGallery ? 'Nuevo tablero' : 'Nueva tarea'}
              </button>
            </div>
            <nav className="browser-tabs" aria-label="Tableros">
              <button className="browser-tab gallery-tab" aria-current={showGallery ? 'page' : undefined} disabled={busy} onClick={() => selectBoard(null)}><LayoutDashboard size={17} />Todos los tableros</button>
              {boards.map((board) => <button key={board.id} className="browser-tab" aria-label={board.name} title={board.name} aria-current={activeBoardId === board.id ? 'page' : undefined} disabled={busy} onClick={() => selectBoard(board.id)}><span>{board.name}</span></button>)}
              <button className="tab-new" aria-label="Nuevo tablero" title="Nuevo tablero" disabled={loading || busy || Boolean(loadError)} onClick={() => setModal({ kind: 'board' })}><Plus size={18} /></button>
            </nav>
            {!showGallery && <div className="board-toolbar">
              <span className="board-summary">{boardTasks.length} tareas</span>
              <div className="toolbar-right">
                <span className="progress-label">
                  <Check size={15} />
                  {done} de {boardTasks.length} terminadas
                </span>
                <button className="printer-status" onClick={() => setModal({ kind: 'prints' })}>
                  <span className={`status-dot ${online ? 'online' : ''}`} />
                  <Printer size={16} />
                  <span>{online ? 'Impresora conectada' : 'Impresora sin conexión'}</span>
                  {pending > 0 && <b>{pending}</b>}
                  {failed > 0 && <b className="failed-count">{failed} error</b>}
                </button>
              </div>
            </div>}
          </>
        )}
        {loadError && (
          <div className="connection-error" role="alert">
            <p>
              {missing
                ? 'Esta tarea no existe o fue eliminada.'
                : `No pudimos actualizar el tablero. ${loadError}`}
            </p>
            <button className="secondary" onClick={() => void reload()}>
              <RefreshCw size={16} />
              Reintentar
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading-state">
            <LoaderCircle className="spin" size={26} />
            <p>Preparando tu espacio…</p>
          </div>
        ) : mobileId ? (
          <div className="mobile-task paper-panel">
            {!missing && mobileTask && detail(mobileTask)}
          </div>
        ) : showGallery ? (
          <BoardGallery boards={boards} tasks={tasks} onOpen={selectBoard} onNew={() => setModal({ kind: 'board' })} onDelete={deleteBoard} disabled={busy || Boolean(loadError)} />
        ) : (
          <Board
            tasks={boardTasks}
            limit={limit}
            busy={busy || Boolean(loadError)}
            onMove={move}
            onNew={(status) => setModal({ kind: 'new', status })}
            onOpen={(task) => setModal({ kind: 'detail', id: task.id })}
            onPrint={print}
          />
        )}
        {!mobileId && !showGallery && (
          <footer className="board-footer">
            <span>
              <span className="tiny-pin" />
              Arrastra tus notas. Encuentra tu ritmo.
            </span>
            <button onClick={() => setModal({ kind: 'help' })}>
              También en tu tablero de verdad
              <ArrowUpRight size={14} />
            </button>
          </footer>
        )}
        {!mobileId && (
          <div className="desk-caption">
            <span>HECHO PARA EQUIPOS QUE HACEN</span>
            <span>Pequeñas herramientas. Grandes equipos.</span>
          </div>
        )}
      </main>
      {modal?.kind === 'members' && (
        <Dialog title="Miembros del espacio" onClose={close}>
          <MembersPanel users={users} onColor={(id, color) => changeMember(() => api.setUserColor(id, color))} />
        </Dialog>
      )}
      {modal?.kind === 'board' && (
        <Dialog title="Nuevo tablero" onClose={close}>
          <BoardForm onSave={createBoard} onCancel={close} />
        </Dialog>
      )}
      {modal?.kind === 'new' && (
        <Dialog title="Una nueva idea." onClose={close}>
          <TaskForm
            status={modal.status}
            users={users}
            printers={printers}
            onSave={save}
            onCancel={close}
          />
        </Dialog>
      )}
      {modal?.kind === 'edit' && selected && (
        <Dialog title="Ajusta tu nota." onClose={close}>
          <TaskForm
            task={selected}
            status={selected.status}
            users={users}
            printers={printers}
            onSave={save}
            onCancel={close}
          />
        </Dialog>
      )}
      {modal?.kind === 'detail' && (
        <Dialog title="Cada tarea cuenta." onClose={close}>
          {selected ? (
            detail(selected)
          ) : (
            <p className="dialog-empty">Esta tarea ya no está en el tablero.</p>
          )}
        </Dialog>
      )}
      {modal?.kind === 'prints' && (
        <Dialog title="Del tablero al papel." onClose={close} wide>
          <div className="print-panel">
            <p className="muted">Los tickets esperan aquí hasta que tu impresora esté conectada.</p>
            <div className="printer-summary">
              <Printer size={24} />
              <div>
                <strong>{activePrinter?.name || 'Sin impresora configurada'}</strong>
                <p>
                  {activePrinter?.location} · {online ? 'Conectada' : 'Esperando al agente local'}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Actualizar cola"
                onClick={() => void reload()}
              >
                <RefreshCw size={18} />
              </button>
            </div>
            <h3>Últimos 50 tickets</h3>
            {!jobs.length ? (
              <div className="dialog-empty">
                <StickyNote size={30} />
                <p>Todavía no hay tickets.</p>
                <small>Usa «Guardar + imprimir» en tu próxima tarea.</small>
              </div>
            ) : (
              <div className="job-list">
                {jobs.map((job) => (
                  <div className="job" key={job.id}>
                    <div>
                      <span className="task-code">
                        #{job.id} · {taskCode(job.ticket.id)}
                      </span>
                      <strong>{job.ticket.title}</strong>
                      {job.error && (
                        <p className="error">
                          {job.error}
                          {job.next_attempt_at && ' Se reintentará automáticamente.'}
                        </p>
                      )}
                    </div>
                    <span className={`job-status job-${job.status.toLowerCase()}`}>
                      {
                        {
                          PENDING: 'En cola',
                          PRINTING: 'Imprimiendo',
                          PRINTED: 'Impreso',
                          FAILED: 'Error',
                        }[job.status]
                      }
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {modal?.kind === 'help' && (
        <Dialog title="Simple. Digital. Tangible." onClose={close}>
          <div className="help-panel">
            <div>
              <span>01</span>
              <h3>Captura lo que sigue.</h3>
              <p>Crea una nota con título, responsable, prioridad y fecha.</p>
            </div>
            <div>
              <span>02</span>
              <h3>Haz espacio para el foco.</h3>
              <p>
                Mueve tus notas entre Por hacer, En proceso y Terminado. Con teclado: enfoca el asa,
                pulsa espacio, usa las flechas y vuelve a pulsar espacio.
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>Llévalo al papel.</h3>
              <p>
                Envía un ticket a tu impresora térmica y pégalo en tu tablero físico. Escanea su QR
                con la cámara del teléfono para actualizar la tarea.
              </p>
            </div>
            <p className="help-footnote">
              El tablero digital guarda el estado real de tu trabajo. El límite WIP es un
              recordatorio: no bloquea tus tareas.
            </p>
          </div>
        </Dialog>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? 'toast-error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          {!notice.error && <Check size={18} />}
          <span>{notice.text}</span>
          <button aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
