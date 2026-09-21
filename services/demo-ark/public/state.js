// Центральное состояние приложения + шина событий + SSE-клиент пайплайна.
// Экраны подписываются на bus и перерисовывают себя сами — без виртуального DOM.

import { uid, toast } from './util.js';
import { seedHistory } from './seed-history.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, cb) => { bus.addEventListener(name, cb); return () => bus.removeEventListener(name, cb); };

export const store = {
  seed: null,
  aiLive: null,
  model: null,
  tenant: null,
  departments: [],
  clients: [],
  deals: [],
  funnelStages: [],
  kbNodes: [],
  kbEdges: [],
  skills: [],
  services: [],
  users: [],
  auditLog: [],
  usageHistory: [],
  quickPrompts: [],
  tasks: {},
  taskOrder: [],
  todos: {},
  interactions: {},
  sessionCost: 0,
  sessionTokensIn: 0,
  sessionTokensOut: 0,
  activeStreams: {},
};

function roleAgents(dept) {
  const out = [];
  (dept.roles || []).forEach((r) => {
    if (r.role === 'lead') out.push({ role: 'Руководитель', nm: `Lead·${dept.name}`, state: 'idle' });
    else {
      const n = Math.min(r.maxAgents || 1, 2);
      for (let i = 1; i <= n; i++) out.push({ role: 'Исполнитель', nm: `Exec·${i}`, state: 'idle' });
    }
  });
  return out;
}

export async function init() {
  const [seed, health] = await Promise.all([
    fetch('/data/seed.json').then((r) => r.json()),
    fetch('/api/health').then((r) => r.json()).catch(() => ({ ok: false, aiLive: false })),
  ]);
  store.seed = seed;
  store.aiLive = !!health.aiLive;
  store.model = health.model || null;
  store.tenant = seed.tenant;
  store.departments = seed.departments.map((d) => ({ ...d, status: 'active', _agents: roleAgents(d), _activeUntil: 0 }));
  store.clients = seed.clients;
  store.deals = seed.deals.map((d) => ({ ...d }));
  store.funnelStages = seed.funnelStages;
  store.kbNodes = seed.kbNodes.map((n) => ({ ...n }));
  store.kbEdges = seed.kbEdges;
  store.skills = seed.skills.map((s) => ({ ...s }));
  store.services = seed.services.map((s) => ({ ...s }));
  store.users = seed.users;
  store.auditLog = seed.auditLog.map((a) => ({ ...a }));
  store.usageHistory = seed.usageHistory.map((u) => ({ ...u }));
  store.quickPrompts = seed.quickPrompts;
  seedHistory(store);
  return store;
}

export function deptById(id) {
  return store.departments.find((d) => d.id === id);
}

function ensureDept(id, fallback) {
  let d = deptById(id);
  if (!d && fallback) {
    d = { ...fallback, status: 'active', _agents: roleAgents(fallback), _activeUntil: 0 };
    store.departments.push(d);
  }
  return d;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addUsage(tokensIn = 0, tokensOut = 0, costUsd = 0) {
  store.sessionCost += costUsd;
  store.sessionTokensIn += tokensIn;
  store.sessionTokensOut += tokensOut;
  const key = todayKey();
  let row = store.usageHistory.find((u) => u.date === key);
  if (!row) { row = { date: key, tokensIn: 0, tokensOut: 0, costUsd: 0 }; store.usageHistory.push(row); }
  row.tokensIn += tokensIn; row.tokensOut += tokensOut; row.costUsd += costUsd;
  emit('usage:update', {});
  emit('session:update', { cost: store.sessionCost });
}

function pushAudit(actor, action) {
  store.auditLog.unshift({ id: uid('a'), actor, action, ts: new Date().toISOString() });
  emit('audit:update', {});
}

function markActive(deptId, ms = 1600) {
  const d = deptById(deptId);
  if (!d) return;
  d._activeUntil = Date.now() + ms;
  emit('departments:update', {});
  setTimeout(() => emit('departments:update', {}), ms + 50);
}

function upsertTodo(board, patch) {
  const list = (store.todos[board] = store.todos[board] || []);
  const idx = list.findIndex((t) => t.id === patch.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  else list.push(patch);
  emit('todos:update', {});
}

function todoByBlock(taskId, blockId) {
  for (const board of Object.keys(store.todos)) {
    const t = store.todos[board].find((x) => x.id === `${taskId}-${blockId}`);
    if (t) return t;
  }
  return null;
}

// ---------- обработка событий пайплайна (общий формат для live и demo-режима) ----------
function applyEvent(name, data) {
  const task = data.taskId ? store.tasks[data.taskId] : null;
  if (task) task.steps.push({ kind: name, data, ts: Date.now() });

  switch (name) {
    case 'task_created': {
      store.tasks[data.taskId] = {
        id: data.taskId, title: data.title, status: 'running', level: null,
        createdAt: Date.now(), steps: [], totalCostUsd: 0, departments: new Set(), direct: null,
      };
      store.taskOrder.unshift(data.taskId);
      emit('tasks:update', { taskId: data.taskId });
      break;
    }
    case 'task_triaged': {
      if (task) task.level = data.result?.level;
      if (data.costUsd) { task.totalCostUsd += data.costUsd; addUsage(data.tokensIn, data.tokensOut, data.costUsd); }
      emit('graph:pulse', { from: 'core', to: 'core', kind: 'triage' });
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      break;
    }
    case 'direct_answer': {
      if (data.costUsd) { task.totalCostUsd += data.costUsd; addUsage(data.tokensIn, data.tokensOut, data.costUsd); }
      emit('tasks:update', { taskId: data.taskId });
      break;
    }
    case 'clarification_requested': {
      store.interactions[data.id] = { ...data, kind: 'clarification' };
      emit('interactions:update', {});
      emit('chat:interaction', { taskId: data.taskId, interaction: store.interactions[data.id] });
      break;
    }
    case 'clarification_answered': {
      delete store.interactions[data.id];
      emit('interactions:update', {});
      break;
    }
    case 'dept_created': {
      const d = store.departments.find((x) => x.id === data.department.id);
      if (!d) {
        store.departments.push({ ...data.department, status: 'active', _agents: roleAgents(data.department), _activeUntil: 0 });
        toast(`Создан временный отдел «${data.department.name}»`, { kind: 'info' });
        pushAudit('Система', `Создан временный отдел «${data.department.name}» под задачу`);
      }
      emit('departments:update', {});
      emit('chat:step', { taskId: data.taskId, name, data });
      break;
    }
    case 'plan_created': {
      if (task) task.plan = data.plan;
      if (data.costUsd) { task.totalCostUsd += data.costUsd; addUsage(data.tokensIn, data.tokensOut, data.costUsd); }
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      break;
    }
    case 'todo_created': {
      const t = data.todo;
      upsertTodo(t.board, { ...t, taskId: data.taskId });
      if (task) task.departments.add(t.board);
      break;
    }
    case 'agent_step': {
      const dept = ensureDept(data.department);
      if (dept) markActive(dept.id, 2200);
      if (data.phase === 'assigned') emit('graph:pulse', { from: 'core', to: data.department });
      if (data.phase === 'reviewing') emit('graph:pulse', { from: data.department, to: 'core' });
      const todo = task ? todoByBlock(task.id, data.blockId) : null;
      if (todo) upsertTodo(data.department, { ...todo, status: data.phase === 'working' ? 'in_progress' : todo.status });
      emit('tasks:update', { taskId: data.taskId });
      break;
    }
    case 'work_result': {
      if (data.costUsd) { task.totalCostUsd += data.costUsd; addUsage(data.tokensIn, data.tokensOut, data.costUsd); }
      const dept = deptById(data.department);
      if (dept) dept.spentUsd = (dept.spentUsd || 0) + (data.costUsd || 0);
      const todo = task ? todoByBlock(task.id, data.blockId) : null;
      const status = data.result?.status === 'blocked' ? 'blocked' : 'review';
      if (todo) upsertTodo(data.department, { ...todo, status });
      emit('departments:update', {});
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      break;
    }
    case 'review_verdict': {
      if (data.costUsd) { task.totalCostUsd += data.costUsd; addUsage(data.tokensIn, data.tokensOut, data.costUsd); }
      emit('tasks:update', { taskId: data.taskId });
      break;
    }
    case 'rework_requested': {
      const todo = task ? todoByBlock(task.id, data.blockId) : null;
      if (todo) upsertTodo(todo.board, { ...todo, status: 'rework' });
      toast('Ревьюер вернул блок на доработку', { kind: 'warn' });
      emit('tasks:update', { taskId: data.taskId });
      break;
    }
    case 'bridge_request':
    case 'bridge_response': {
      emit('graph:pulse', { from: data.from, to: data.to, kind: 'bridge' });
      break;
    }
    case 'acceptance_verdict': {
      if (data.costUsd) { task.totalCostUsd += data.costUsd; addUsage(data.tokensIn, data.tokensOut, data.costUsd); }
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      break;
    }
    case 'approval_requested': {
      store.interactions[data.id] = { ...data, kind: 'approval' };
      emit('interactions:update', {});
      emit('chat:interaction', { taskId: data.taskId, interaction: store.interactions[data.id] });
      break;
    }
    case 'approval_decided': {
      delete store.interactions[data.id];
      emit('interactions:update', {});
      break;
    }
    case 'task_done': {
      if (task) {
        task.status = 'done';
        task.summary = data.summary;
        task.artifact = data.artifact;
        task.durationMs = data.durationMs;
      }
      task.departments.forEach((id) => {
        for (const board of Object.keys(store.todos)) {
          store.todos[board].forEach((t) => { if (t.taskId === data.taskId) t.status = 'done'; });
        }
      });
      pushAudit('Система', `Задача «${task ? task.title : data.taskId}» выполнена`);
      emit('todos:update', {});
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      toast('Задача выполнена', { kind: 'ok' });
      break;
    }
    case 'task_escalated': {
      if (task) { task.status = 'escalated'; task.escalationReason = data.reason; }
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      toast('Задача эскалирована к человеку', { kind: 'warn' });
      break;
    }
    case 'error': {
      if (task) { task.status = 'error'; task.error = data.message; }
      emit('tasks:update', { taskId: data.taskId });
      emit('chat:step', { taskId: data.taskId, name, data });
      toast(data.message || 'Ошибка пайплайна', { kind: 'danger' });
      break;
    }
    case 'done': {
      if (data.taskId) delete store.activeStreams[data.taskId];
      emit('stream:done', { taskId: data.taskId });
      break;
    }
    default:
      break;
  }
}

export function startTask(text) {
  const taskId = uid('t');
  const es = new EventSource(`/api/task/stream?taskId=${encodeURIComponent(taskId)}&text=${encodeURIComponent(text)}`);
  store.activeStreams[taskId] = es;
  const names = [
    'task_created', 'task_triaged', 'direct_answer', 'clarification_requested', 'clarification_answered',
    'dept_created', 'plan_created', 'todo_created', 'agent_step', 'work_result', 'review_verdict',
    'rework_requested', 'bridge_request', 'bridge_response', 'acceptance_verdict', 'approval_requested',
    'approval_decided', 'task_done', 'task_escalated', 'error', 'done',
  ];
  names.forEach((n) => {
    es.addEventListener(n, (ev) => {
      let data = {};
      try { data = JSON.parse(ev.data); } catch { /* ignore */ }
      applyEvent(n, data);
      if (n === 'done') es.close();
    });
  });
  es.onerror = () => {
    if (store.tasks[taskId] && store.tasks[taskId].status === 'running') {
      store.tasks[taskId].status = 'error';
      store.tasks[taskId].error = 'Соединение с сервером потеряно';
      emit('tasks:update', { taskId });
      emit('chat:step', { taskId, name: 'error', data: { message: 'Соединение с сервером потеряно' } });
    }
    es.close();
  };
  return taskId;
}

export async function resolveInteraction(id, data) {
  // Подтверждения из фейковой истории (seed-history.js) ни к какому реальному
  // потоку на сервере не привязаны — решаем их локально, без похода в /api.
  if (id.startsWith('seed_')) { resolveSeedInteraction(id, data); return; }
  try {
    const res = await fetch(`/api/interactions/${encodeURIComponent(id)}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
  } catch (e) {
    toast('Не удалось отправить решение — сервер недоступен', { kind: 'danger' });
  }
}

function resolveSeedInteraction(id, data) {
  const itx = store.interactions[id];
  if (!itx) return;
  delete store.interactions[id];
  const task = store.tasks[itx.taskId];
  const decision = data.decision || 'approve';
  if (decision === 'approve') {
    if (task) {
      task.status = 'done';
      task.summary = itx.summary;
      task.artifact = itx.artifact;
      task.durationMs = task.durationMs || Date.now() - task.createdAt;
      task.steps.push({ kind: 'approval_decided', ts: Date.now(), data: { taskId: itx.taskId, decision: 'approve' } });
      task.steps.push({ kind: 'task_done', ts: Date.now(), data: { taskId: itx.taskId, summary: itx.summary, artifact: itx.artifact } });
    }
    for (const board of Object.keys(store.todos)) {
      store.todos[board].forEach((t) => { if (t.taskId === itx.taskId) t.status = 'done'; });
    }
    pushAudit('Система', `Задача «${task ? task.title : itx.taskId}» выполнена`);
    toast('Задача выполнена', { kind: 'ok' });
  } else {
    if (task) {
      task.status = 'escalated';
      task.escalationReason = 'Отклонено на этапе подтверждения';
      task.steps.push({ kind: 'task_escalated', ts: Date.now(), data: { taskId: itx.taskId, reason: 'Отклонено на этапе подтверждения' } });
    }
    toast('Задача эскалирована к человеку', { kind: 'warn' });
  }
  emit('interactions:update', {});
  emit('todos:update', {});
  emit('tasks:update', { taskId: itx.taskId });
}

export function sortedTasks() {
  return store.taskOrder.map((id) => store.tasks[id]).filter(Boolean);
}
