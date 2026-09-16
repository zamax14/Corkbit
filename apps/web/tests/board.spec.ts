import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  const tasks = await (await request.get('/api/tasks')).json();
  for (const task of tasks) await request.delete(`/api/tasks/${task.id}`);
  // Los tableros creados por una prueba no deben condicionar a la siguiente; «Mi tablero» es el 1.
  const boards = await (await request.get('/api/boards')).json();
  for (const board of boards)
    if (board.id !== 1)
      await request.delete(`/api/boards/${board.id}`, { data: { confirm: true } });
});

test('crear, imprimir, editar, mover, recargar y eliminar', async ({ page, request }) => {
  await page.goto('/?board=1');
  await expect(page.getByRole('heading', { name: 'Tu trabajo, a la vista.' })).toBeVisible();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('¿Qué hay que hacer?').fill('Terminar integración MCP');
  await page.getByLabel('Descripción').fill('Preparar versión para pruebas');
  await page.getByText('Responsable, fecha y más', { exact: true }).click();
  // El responsable sale de la lista de miembros: ya no se teclea un nombre nuevo.
  await page
    .getByRole('combobox', { name: 'Responsable', exact: true })
    .selectOption({ label: 'Persona de prueba' });
  await page.getByLabel('Fecha límite').fill('2026-09-11');
  await page.getByRole('combobox', { name: 'Prioridad', exact: true }).selectOption('HIGH');
  await page.getByText('Opciones de impresión', { exact: true }).click();
  await page.getByRole('button', { name: 'Guardar + imprimir' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Terminar integración MCP' }),
  ).toBeVisible();
  const tasks = await (await request.get('/api/tasks')).json();
  const id = tasks[0].id;
  expect(tasks[0].assignee.name).toBe('Persona de prueba');
  const jobs = await (await request.get('/api/print-jobs')).json();
  expect(jobs.some((job: { task_id: number }) => job.task_id === id)).toBeTruthy();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('¿Qué hay que hacer?').fill('MCP listo para revisión');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('button', { name: 'En proceso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'En proceso', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'En proceso' })
      .getByRole('heading', { name: 'MCP listo para revisión' }),
  ).toBeVisible();
  await page.goto(`/t/${id}`);
  await page.getByRole('button', { name: 'Terminado', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Terminado', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Compartir e imprimir', { exact: true }).click();
  await page.getByRole('button', { name: 'Reimprimir', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'cola de impresión' })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar tarea', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, eliminar tarea' }).click();
  await expect(page.getByText('Esta tarea no existe o fue eliminada.')).toBeVisible();
  expect((await request.get(`/api/tasks/${id}`)).status()).toBe(404);
});

test('arrastre con teclado y aviso WIP sin bloquear', async ({ page, request }) => {
  await request.post('/api/tasks', { data: { title: 'Ya en curso', status: 'WIP' } });
  const task = await (
    await request.post('/api/tasks', { data: { title: 'Mover con teclado' } })
  ).json();
  await page.goto('/?board=1');
  const handle = page.getByRole('button', { name: 'Mover Mover con teclado', exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.drag-card .note')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('status')).toHaveText('Destino: En proceso');
  await page.keyboard.press('Space');
  await expect(
    page
      .getByRole('region', { name: 'En proceso' })
      .getByRole('heading', { name: 'Mover con teclado' }),
  ).toBeVisible();
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).status).toBe('WIP');
  await expect(
    page.getByText('Límite WIP alcanzado. Termina algo antes de empezar más.'),
  ).toBeVisible();
});

test('arrastre con puntero entre columnas', async ({ page, request }) => {
  // El corcho arranca por debajo de los 720 px del viewport por defecto, y el asa vive en
  // opacity 0 hasta que el puntero entra en la nota: hay que darle alto y pasar por encima
  // antes de agarrarla. Se agarra por su esquina, que es donde el asa tiene superficie real,
  // y el primer desplazamiento va en pasos para superar el umbral de 8 px de dnd-kit.
  await page.setViewportSize({ width: 1440, height: 1200 });
  await request.post('/api/tasks', { data: { title: 'Mover con ratón' } });
  await page.goto('/?board=1');
  const grip = page.getByRole('button', { name: 'Mover Mover con ratón', exact: true });
  await grip.hover({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(250);
  const handle = await grip.boundingBox();
  const column = await page.getByRole('region', { name: 'Terminado' }).boundingBox();
  if (!handle || !column) throw new Error('No se encontró el destino');
  await page.mouse.move(handle.x + handle.width - 8, handle.y + handle.height - 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width + 12, handle.y + handle.height, { steps: 3 });
  await page.mouse.move(column.x + column.width / 2, column.y + 120, { steps: 15 });
  await page.mouse.up();
  await expect(
    page
      .getByRole('region', { name: 'Terminado' })
      .getByRole('heading', { name: 'Mover con ratón' }),
  ).toBeVisible();
});

test('inserta entre notas y conserva el orden al recargar', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  for (const title of ['Última', 'Primera'])
    await request.post('/api/tasks', { data: { title, status: 'WIP' } });
  await request.post('/api/tasks', { data: { title: 'Insertar aquí' } });
  await page.goto('/?board=1');
  const target = page.getByRole('region', { name: 'En proceso' });
  const handle = page.getByRole('button', { name: 'Mover Insertar aquí', exact: true });
  await handle.hover({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(250);
  const source = await handle.boundingBox();
  const last = await target.locator('.note').last().boundingBox();
  if (!source || !last) throw new Error('Falta una tarjeta');
  await page.mouse.move(source.x + source.width - 8, source.y + source.height - 8);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width + 12, source.y + source.height, { steps: 3 });
  await page.mouse.move(last.x + last.width / 2, last.y + last.height * 0.55, { steps: 15 });
  await page.mouse.up();
  await expect(target.locator('.note h3')).toHaveText(['Primera', 'Insertar aquí', 'Última']);
  await page.reload();
  await expect(target.locator('.note h3')).toHaveText(['Primera', 'Insertar aquí', 'Última']);
});

test('vista móvil desde QR, sin desbordamiento', async ({ page, request }) => {
  const task = await (
    await request.post('/api/tasks', {
      data: { title: 'Tarea desde el teléfono', description: 'Comprobar vista móvil' },
    })
  ).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/t/${task.id}`);
  await expect(page.getByRole('heading', { name: 'Tarea desde el teléfono' })).toBeVisible();
  await page.getByText('Compartir e imprimir', { exact: true }).click();
  await expect(
    page.locator('svg').filter({ has: page.locator('title', { hasText: 'Abrir TASK-' }) }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'En proceso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'En proceso', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('errores de guardado conservan el formulario y no inventan tareas', async ({ page }) => {
  await page.goto('/?board=1');
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('¿Qué hay que hacer?').fill('Conservar borrador');
  await page.route('**/api/tasks', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, json: { detail: 'Servidor no disponible' } })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Servidor no disponible');
  await expect(page.getByLabel('¿Qué hay que hacer?')).toHaveValue('Conservar borrador');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('tablero de demostración', async ({ page, request }) => {
  const user = await (await request.post('/api/users', { data: { name: 'Alex' } })).json();
  for (const data of [
    {
      title: 'Preparar la integración con el MCP',
      description: 'Dejar todo listo para las primeras pruebas.',
      priority: 'HIGH',
      status: 'BACKLOG',
    },
    {
      title: 'Dar forma al nuevo dashboard',
      description: 'Una primera mirada a los indicadores del mes.',
      priority: 'MEDIUM',
      status: 'BACKLOG',
    },
    {
      title: 'Documentar el flujo de datos',
      description: 'Un mapa sencillo para el equipo.',
      priority: 'LOW',
      status: 'BACKLOG',
    },
    {
      title: 'Corregir el pipeline de población',
      description: 'Revisar la carga y validar los totales.',
      priority: 'URGENT',
      status: 'WIP',
    },
    {
      title: 'Conectar el primer tablero',
      description: 'Un pequeño paso. Un buen comienzo.',
      priority: 'LOW',
      status: 'DONE',
    },
  ])
    await request.post('/api/tasks', {
      data: { ...data, assignee_id: user.id, deadline: '2026-09-11' },
    });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/?board=1');
  await expect(
    page.getByRole('heading', { name: 'Preparar la integración con el MCP' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/board.png', fullPage: true });
});

test('los miembros vienen de Keycloak y no se teclean a mano', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?board=1');
  await page.getByRole('button', { name: /Miembros/ }).click();

  // Ya no hay alta por texto: un miembro sin cuenta no debe poder existir.
  await expect(page.getByLabel('Nombre del miembro')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agregar miembro', exact: true })).toHaveCount(0);
  await expect(page.getByText(/créale una cuenta en Keycloak/)).toBeVisible();

  // Quien ya inició sesión sí aparece, y sigue siendo asignable.
  const members = page.getByRole('list', { name: 'Miembros del espacio' });
  await expect(members.getByText('Persona de prueba', { exact: true })).toBeVisible();
  expect((await (await request.get('/api/tasks')).json()).length).toBe(0);
  await page.screenshot({ path: 'test-results/members-mobile.png', fullPage: true });

  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('¿Qué hay que hacer?').fill('Tarea asignada');
  await page.getByText('Responsable, fecha y más', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Responsable', exact: true })
    .selectOption({ label: 'Persona de prueba' });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Persona de prueba')).toBeVisible();
});

test('crear tableros, separar tareas y volver desde QR al tablero correcto', async ({
  page,
  request,
}) => {
  await request.post('/api/tasks', {
    data: { title: 'Tarea del tablero original', status: 'WIP' },
  });
  await page.goto('/?board=1');
  await page
    .getByRole('navigation', { name: 'Tableros' })
    .getByRole('button', { name: 'Nuevo tablero', exact: true })
    .click();
  await page.getByLabel('Nombre del tablero').fill('Lanzamiento');
  await page.getByRole('button', { name: 'Crear tablero', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lanzamiento', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'Tarea del tablero original' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await page.getByLabel('¿Qué hay que hacer?').fill('Tarea del lanzamiento');
  await page.getByText('Responsable, fecha y más', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('WIP');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tarea del lanzamiento' })).toBeVisible();
  await expect(
    page.getByText('Límite WIP alcanzado. Termina algo antes de empezar más.'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Mi tablero', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tarea del tablero original' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tarea del lanzamiento' })).toHaveCount(0);
  const tasks = await (await request.get('/api/tasks')).json();
  const task = tasks.find((item: { title: string }) => item.title === 'Tarea del lanzamiento');
  await page.goto(`/t/${task.id}`);
  await page.getByRole('link', { name: 'Volver al tablero' }).click();
  await expect(page.getByRole('heading', { name: 'Tarea del lanzamiento' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/boards-mobile.png', fullPage: true });
});

test('imprimir aquí sella la tarea y deja solo el ticket de 80 mm', async ({ page, request }) => {
  const task = await (await request.post('/api/tasks', { data: { title: 'Ticket local' } })).json();
  await page.goto(`/t/${task.id}`);
  await page.getByText('Compartir e imprimir', { exact: true }).click();
  await expect(page.getByText('Sin imprimir')).toBeVisible();
  await page.getByRole('button', { name: 'Imprimir aquí' }).click();
  await expect(page.getByText(/^Impresa · /)).toBeVisible();
  expect((await (await request.get(`/api/tasks/${task.id}`)).json()).printed_at).toBeTruthy();
  // El ticket vive fuera del árbol de la app: al imprimir es lo único que queda en la hoja.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.ticket-sheet')).toBeVisible();
  await expect(page.locator('.ticket-sheet h1')).toHaveText('Ticket local');
  await expect(page.locator('.app-shell')).toBeHidden();
  await page.screenshot({ path: 'test-results/ticket.png' });
  await page.emulateMedia({ media: 'screen' });
  // El sello no bloquea la cola.
  await page.getByRole('button', { name: 'Reimprimir', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'cola de impresión' })).toBeVisible();
});

test('galería de tableros: vista previa, apertura y borrado con confirmación', async ({
  page,
  request,
}) => {
  const board = await (await request.post('/api/boards', { data: { name: 'Lanzamiento' } })).json();
  await request.post('/api/tasks', { data: { title: 'Plan de prensa', board_id: board.id } });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tus tableros.' })).toBeVisible();
  // La miniatura muestra las notas reales del tablero, no un marcador.
  const preview = page.getByRole('button', { name: `Abrir tablero ${board.name}` });
  await expect(preview.getByText('Plan de prensa')).toBeVisible();
  await preview.click();
  await expect(page.getByRole('button', { name: 'Lanzamiento', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('button', { name: 'Todos los tableros', exact: true }).click();
  await page.getByRole('button', { name: `Eliminar tablero ${board.name}` }).click();
  await expect(page.getByRole('dialog').getByText('1 tareas')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: `Eliminar tablero ${board.name}` }).click();
  await page.getByRole('button', { name: 'Sí, eliminar tablero' }).click();
  await expect(preview).toHaveCount(0);
  expect((await (await request.get('/api/boards')).json()).length).toBe(1);
  expect((await (await request.get('/api/tasks')).json()).length).toBe(0);
});

test('historial de comentarios: escribir, ver en la tarjeta y borrar', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/tasks', { data: { title: 'Entregar capítulo' } });
  const task = await created.json();
  expect(task.comment_count).toBe(0);

  await page.goto(`/t/${task.id}`);
  await page.getByText('Comentarios', { exact: true }).click();
  await expect(page.getByText(/Sin comentarios todavía/)).toBeVisible();
  await page.getByLabel('Nuevo comentario').fill('Hablé con el asesor');
  await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(page.getByText('Hablé con el asesor')).toBeVisible();
  // Comentar refresca el tablero para el contador de la tarjeta; ese re-render reescribe el
  // textarea controlado, así que se espera a que aterrice antes de escribir el siguiente.
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Nuevo comentario').fill('Falta corregir el template');
  await page.getByRole('button', { name: 'Comentar', exact: true }).click();
  // Lo más reciente va arriba: el timeline se lee de la última novedad hacia atrás.
  await expect(page.locator('.timeline-list li p')).toHaveText([
    'Falta corregir el template',
    'Hablé con el asesor',
  ]);

  // Comentar no mueve la tarea, pero sí deja rastro en el tablero.
  const after = await (await request.get(`/api/tasks/${task.id}`)).json();
  expect(after.comment_count).toBe(2);
  expect(after.last_comment).toBe('Falta corregir el template');
  expect(after.updated_at).toBe(task.updated_at);

  await page.goto('/?board=1');
  await expect(page.locator(`[data-task-id="${task.id}"] .comment-mark`)).toHaveText('2');

  await page.locator(`[data-task-id="${task.id}"] .note-body`).click();
  await page.getByText('Comentarios · 2', { exact: true }).click();
  await page.locator('.timeline-list li').first().hover();
  await page
    .getByRole('button', { name: /^Borrar comentario del/ })
    .first()
    .click();
  await expect(page.locator('.timeline-list li p')).toHaveText(['Hablé con el asesor']);
});

test('nota sencilla: opciones plegadas, edición y papel sin desbordar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?board=1');
  await page.getByRole('button', { name: 'Nueva tarea', exact: true }).click();
  await expect(page.getByLabel('Responsable', { exact: true })).toBeHidden();
  await page.getByLabel('¿Qué hay que hacer?').fill('Preparar la entrega del viernes');
  await page.getByLabel('Descripción').fill('Revisar los últimos cambios con el equipo.');
  await page.screenshot({ path: 'test-results/note-create-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByLabel('Nuevo comentario')).toBeHidden();
  await expect(page.getByRole('dialog').locator('.task-paper')).toContainText(
    'Preparar la entrega',
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/note-detail-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByLabel('Descripción')).toHaveValue(
    'Revisar los últimos cambios con el equipo.',
  );
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.ticket-sheet')).not.toContainText('Sin asignar');
  await expect(page.locator('.ticket-sheet')).not.toContainText('Sin fecha');
  await page.screenshot({ path: 'test-results/note-ticket.png' });
});
