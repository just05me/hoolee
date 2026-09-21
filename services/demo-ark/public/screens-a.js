import { store, on, deptById, resolveInteraction, sortedTasks } from './state.js';
import { esc, fmtUsd, fmtTokens, fmtDur, timeAgo, jsonViewer, bindJsonToggles } from './util.js';
import { sparkline, hbar } from './charts.js';
import { icon } from './icons.js';
import { openDrawer, kv } from './drawer.js';
import { GraphRenderer, orgLayout } from './graph.js';

const levelLabel = (l) => ({ simple: 'простой', medium: 'одна задача', complex: 'несколько отделов', out_of_scope: 'вне отделов' }[l] || l || '—');
const verdictLabel = (v) => ({ accept: 'принято', rework: 'доработка', escalate: 'эскалация', pass: 'ок', reject: 'отклонено' }[v] || v);
const statusChip = (s) => ({
  running: '<span class="chip live accent"><span class="cd"></span>идёт</span>',
  done: '<span class="chip ok">выполнено</span>',
  escalated: '<span class="chip warn">эскалировано</span>',
  error: '<span class="chip danger">ошибка</span>',
}[s] || `<span class="chip">${s}</span>`);

function bindDelegation(container, map) {
  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    const action = el.getAttribute('data-action');
    if (map[action]) map[action](el, e);
  });
}

export function openDeptDrawer(id) {
  const d = deptById(id);
  if (!d) return;
  const agentsHtml = (d._agents || []).map((a) => `
    <div class="hstack" style="padding:8px 0;border-bottom:1px solid var(--stroke-2)">
      <span class="chip ${a.state === 'working' ? 'accent' : ''}" style="min-width:88px;justify-content:center">${esc(a.role)}</span>
      <span style="font-size:12.5px;font-weight:600">${esc(a.nm)}</span>
      <span class="spacer"></span>
      <span class="muted" style="font-size:11.5px">${a.state === 'working' ? 'в работе' : 'ожидает'}</span>
    </div>`).join('');
  const pct = Math.min(100, Math.round(((d.spentUsd || 0) / d.budgetUsdMonth) * 100));
  openDrawer(d.kind === 'temporary' ? 'временный отдел' : 'отдел', d.name, `
    ${kv('Статус', d.status === 'dormant' ? 'спит' : 'активен')}
    ${kv('Бюджет / мес', `${fmtUsd(d.spentUsd || 0)} из ${fmtUsd(d.budgetUsdMonth)}`)}
    <div class="bar" style="margin:2px 0 16px"><i style="width:${pct}%;background:${d.color}"></i></div>
    ${kv('Простой до расформирования', `${d.idleDespawnMin || 15} мин`)}
    ${kv('Навыки', (d.skills || []).join(', ') || '—')}
    <div class="section-title" style="margin-top:18px">Агенты</div>
    ${agentsHtml || '<div class="muted" style="font-size:12.5px">Нет активных агентов</div>'}
  `);
}

function taskDrawerBody(t) {
  return `
    ${kv('Статус', t.status)}
    ${kv('Уровень', levelLabel(t.level))}
    ${kv('Создана', timeAgo(t.createdAt))}
    ${kv('Стоимость', fmtUsd(t.totalCostUsd || 0))}
    ${t.artifact ? `<div class="section-title" style="margin-top:16px">Результат</div><div class="approval-card"><div class="artifact" style="margin:0">${esc(t.artifact)}</div></div>` : ''}
  `;
}

// ===================================================================
// ДАШБОРД
// ===================================================================
export const dashboardScreen = {
  id: 'dashboard', title: 'Дашборд', subtitle: 'Обзор системы в реальном времени',
  render() {
    const tasks = sortedTasks();
    const running = tasks.filter((t) => t.status === 'running').length;
    const todayStr = new Date().toDateString();
    const doneToday = tasks.filter((t) => t.status === 'done' && new Date(t.createdAt).toDateString() === todayStr).length;
    const todayUsage = store.usageHistory[store.usageHistory.length - 1] || { costUsd: 0 };
    const last7 = store.usageHistory.slice(-7).map((u) => u.costUsd);
    const doneList = tasks.filter((t) => t.status === 'done' && t.durationMs);
    const avgCycle = doneList.length ? Math.round(doneList.reduce((s, t) => s + t.durationMs, 0) / doneList.length) : null;

    const deptRows = store.departments.map((d) => {
      const pct = Math.min(100, Math.round(((d.spentUsd || 0) / d.budgetUsdMonth) * 100));
      const active = d._activeUntil > Date.now();
      return `<div class="dept-row" data-action="open-dept" data-id="${d.id}">
        <span class="dept-dot" style="background:${d.color}${active ? ';box-shadow:0 0 0 4px ' + d.color + '33' : ''}"></span>
        <div style="flex:1;min-width:0">
          <div class="nm">${esc(d.name)}${d.kind === 'temporary' ? ' <span class="chip" style="margin-left:4px">врем.</span>' : ''}</div>
          <div class="bar"><i style="width:${pct}%;background:${d.color}"></i></div>
        </div>
        <div class="agents num">${fmtUsd(d.spentUsd || 0)}<br><span style="opacity:.6">из ${fmtUsd(d.budgetUsdMonth)}</span></div>
      </div>`;
    }).join('');

    const stageCounts = store.funnelStages.map((s) => ({
      label: s.label, value: store.deals.filter((d) => d.stage === s.id).length, color: s.color,
    })).filter((s) => s.value > 0);

    const feed = store.auditLog.slice(0, 6).map((a) => `
      <div class="hstack" style="padding:9px 0;border-bottom:1px solid var(--stroke-2);font-size:12.5px">
        <span style="font-weight:650;min-width:90px">${esc(a.actor)}</span>
        <span class="muted" style="flex:1">${esc(a.action)}</span>
        <span class="muted" style="font-size:11px">${timeAgo(new Date(a.ts).getTime())}</span>
      </div>`).join('');

    const svc = store.services.map((s) => `<span class="chip ${s.status === 'ok' ? 'ok' : ''}" data-tip="${esc(s.note)}"><span class="cd"></span>${esc(s.name)}</span>`).join('');

    return `<div class="content-inner">
      <div class="grid cols-4" style="margin-bottom:var(--sp-5)">
        <div class="kpi"><div class="lbl">Активные задачи</div><div class="val num">${running}</div>
          <div class="delta ${running ? 'up' : ''}">${running ? 'выполняются сейчас' : 'нет активных'}</div></div>
        <div class="kpi"><div class="lbl">Выполнено сегодня</div><div class="val num">${doneToday}</div>
          <div class="delta">за сегодняшнюю сессию</div></div>
        <div class="kpi"><div class="lbl">Расход ИИ сегодня</div><div class="val num">${fmtUsd(todayUsage.costUsd)}</div>
          <div class="spark">${sparkline(last7.length ? last7 : [0], { color: 'var(--accent)' })}</div></div>
        <div class="kpi"><div class="lbl">Средний цикл задачи</div><div class="val num">${avgCycle ? fmtDur(avgCycle) : '—'}</div>
          <div class="delta">${doneList.length} завершённых</div></div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h3>Отделы</h3><span class="sub">клик — подробности</span></div>
          ${deptRows}
        </div>
        <div class="card">
          <div class="card-head"><h3>Воронка продаж</h3><span class="sub">${store.deals.length} сделок</span></div>
          ${stageCounts.length ? hbar(stageCounts, { width: 460 }) : '<div class="empty"><div class="t">Нет сделок</div></div>'}
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:var(--sp-5)">
        <div class="card">
          <div class="card-head"><h3>Журнал активности</h3></div>
          ${feed || '<div class="empty"><div class="t">Пока пусто</div></div>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>Сервисы</h3><span class="sub">статус подключений</span></div>
          <div class="hstack" style="flex-wrap:wrap;gap:8px">${svc}</div>
        </div>
      </div>
    </div>`;
  },
  mount(container) {
    bindDelegation(container, { 'open-dept': (el) => openDeptDrawer(el.getAttribute('data-id')) });
    const repaint = () => { container.innerHTML = dashboardScreen.render(); };
    const offs = ['tasks:update', 'departments:update', 'usage:update', 'audit:update'].map((n) => on(n, repaint));
    return () => offs.forEach((f) => f());
  },
};

// ===================================================================
// ОРГСТРУКТУРА
// ===================================================================
export const orgScreen = {
  id: 'org', title: 'Оргструктура', subtitle: 'Ядро → отделы → агенты, в реальном времени',
  render() {
    return `<div class="content-inner">
      <div class="graph-wrap" id="orgGraphWrap">
        <canvas id="orgCanvas"></canvas>
        <div class="graph-hint">Клик по узлу — детали · пульсы — реальные события пайплайна</div>
        <div class="graph-legend">
          ${store.departments.map((d) => `<span class="chip" style="color:${d.color}"><span class="cd" style="background:${d.color}"></span>${esc(d.name)}</span>`).join('')}
        </div>
      </div>
      <div class="grid cols-3" style="margin-top:var(--sp-5)">
        ${store.departments.map((d) => `
          <div class="card" data-action="open-dept" data-id="${d.id}" style="cursor:pointer">
            <div class="hstack"><span class="dept-dot" style="background:${d.color}"></span>
              <b style="font-size:13px">${esc(d.name)}</b><span class="spacer"></span>
              <span class="chip ${d.status === 'dormant' ? '' : 'ok'}">${d.status === 'dormant' ? 'спит' : 'активен'}</span>
            </div>
            <div class="muted" style="font-size:12px;margin-top:8px">${(d._agents || []).length} агентов · мосты: ${(d.bridges || []).map((b) => deptById(b)?.name || b).join(', ') || '—'}</div>
          </div>`).join('')}
      </div>
    </div>`;
  },
  mount(container) {
    bindDelegation(container, { 'open-dept': (el) => openDeptDrawer(el.getAttribute('data-id')) });
    const canvas = container.querySelector('#orgCanvas');
    const renderer = new GraphRenderer(canvas, { onNodeClick: (id) => { if (id !== 'core') openDeptDrawer(id); } });
    const paint = () => {
      const { nodes, edges } = orgLayout('core', store.departments);
      renderer.setGraph({ nodes, edges });
    };
    paint();
    const offDept = on('departments:update', () => {
      paint();
      // подсветить временный чек-лист карточек тоже, но canvas достаточно
    });
    const offPulse = on('graph:pulse', (e) => {
      const { from, to } = e.detail;
      if (from === to) { renderer.updateNode('core', { flash: performance.now() }); return; }
      renderer.pulse(from === 'core' ? 'core' : from, to, { color: 'var(--accent)' });
    });
    return () => { offDept(); offPulse(); renderer.destroy(); };
  },
};

// ===================================================================
// ПРОЦЕССЫ
// ===================================================================
let selectedTaskId = null;

function stepMeta(step) {
  const { kind, data } = step;
  switch (kind) {
    case 'task_created': return { icon: icon.play, cls: 'done', title: 'Задача создана', body: '' };
    case 'task_triaged': return { icon: icon.search, cls: 'done', title: `Первичная оценка — ${levelLabel(data.result?.level)}`,
      body: `${(data.result?.departments || []).map((d) => deptById(d)?.name || d).join(', ') || '—'} · увер. ${Math.round((data.result?.confidence || 0) * 100)}%`, meta: data };
    case 'direct_answer': return { icon: icon.chat, cls: 'done', title: 'Базовый ИИ ответил напрямую', body: data.result?.answer || '', meta: data };
    case 'clarification_requested': return { icon: icon.info, cls: 'active', title: 'Нужно уточнение', body: (data.questions || []).join(' ') };
    case 'clarification_answered': return { icon: icon.check, cls: 'done', title: 'Уточнение получено', body: data.answers || '—' };
    case 'dept_created': return { icon: icon.org, cls: 'done', title: `Создан временный отдел «${data.department?.name}»`, body: '' };
    case 'plan_created': return { icon: icon.skills, cls: 'done', title: `План: ${(data.plan?.blocks || []).length} блок(ов)`,
      body: (data.plan?.blocks || []).map((b) => `«${b.title}» → ${deptById(b.department)?.name || b.department}`).join('; '), meta: data };
    case 'agent_step': {
      if (data.phase === 'working') return { icon: icon.spark, cls: 'active', title: `${deptById(data.department)?.name || data.department} · Исполнитель работает`, body: '' };
      if (data.phase === 'reviewing') return { icon: icon.spark, cls: 'active', title: `${deptById(data.department)?.name || data.department} · Ревьюер проверяет`, body: '' };
      return null;
    }
    case 'work_result': return {
      icon: data.result?.status === 'done' ? icon.check : icon.x, cls: data.result?.status === 'done' ? 'done' : 'error',
      title: `${deptById(data.department)?.name || data.department} · результат: ${data.result?.status === 'done' ? 'готово' : 'заблокировано'}`,
      body: data.result?.artifact || (data.result?.blockers || []).join('; '), meta: data,
    };
    case 'review_verdict': return { icon: data.result?.verdict === 'pass' ? icon.check : icon.refresh, cls: data.result?.verdict === 'pass' ? 'done' : 'rework',
      title: `Ревьюер: ${verdictLabel(data.result?.verdict)}`, body: (data.result?.issues || []).map((i) => i.text).join('; '), meta: data };
    case 'rework_requested': return { icon: icon.refresh, cls: 'rework', title: 'Отправлено на доработку', body: (data.issues || []).map((i) => i.text).join('; ') };
    case 'acceptance_verdict': return { icon: icon.check, cls: data.result?.verdict === 'accept' ? 'done' : 'rework',
      title: `Акцептор: ${verdictLabel(data.result?.verdict)}`, body: data.result?.comment || '', meta: data };
    case 'approval_requested': return { icon: icon.approvals, cls: 'active', title: 'Запрошено подтверждение человека', body: data.summary || '' };
    case 'approval_decided': return { icon: icon.check, cls: 'done', title: `Подтверждение: ${data.decision === 'approve' ? 'да' : 'нет'}`, body: '' };
    case 'task_done': return { icon: icon.check, cls: 'done', title: 'Задача выполнена', body: data.summary || '' };
    case 'task_escalated': return { icon: icon.x, cls: 'error', title: 'Эскалировано к человеку', body: data.reason || '' };
    case 'error': return { icon: icon.x, cls: 'error', title: 'Ошибка', body: data.message || '' };
    default: return null;
  }
}

function taskTimelineHtml(t) {
  const rows = t.steps.map(stepMeta).filter(Boolean).map((s) => `
    <div class="tl-step ${s.cls}">
      <div class="tl-dot">${s.icon}</div>
      <div class="tl-head"><span class="tl-role">${esc(s.title)}</span></div>
      ${s.body ? `<div class="tl-body">${esc(s.body)}</div>` : ''}
      ${s.meta ? jsonViewer(s.meta, 'Данные шага') : ''}
    </div>`).join('');
  return `<div class="hstack" style="margin-bottom:var(--sp-4)">
      <h3 style="font-size:15px">${esc(t.title)}</h3><span class="spacer"></span>${statusChip(t.status)}
    </div>
    ${t.error ? `<div class="chip danger" style="margin-bottom:12px">${esc(t.error)}</div>` : ''}
    ${t.escalationReason ? `<div class="chip warn" style="margin-bottom:12px">${esc(t.escalationReason)}</div>` : ''}
    <div class="timeline">${rows || '<div class="muted">Нет шагов</div>'}</div>`;
}

export const processesScreen = {
  id: 'processes', title: 'Процессы', subtitle: 'Жизненный цикл задач — от оценки до приёмки',
  render() {
    const tasks = sortedTasks();
    if (!selectedTaskId && tasks[0]) selectedTaskId = tasks[0].id;
    const list = tasks.map((t) => `
      <div class="task-row ${t.id === selectedTaskId ? 'selected' : ''}" data-action="select" data-id="${t.id}">
        ${statusChip(t.status)}
        <div class="t"><div class="tt">${esc(t.title)}</div><div class="ts">${timeAgo(t.createdAt)} · ${fmtUsd(t.totalCostUsd || 0)}</div></div>
      </div>`).join('');
    const selected = tasks.find((t) => t.id === selectedTaskId);
    return `<div class="content-inner grid cols-2" style="align-items:flex-start">
      <div class="card" style="max-height:640px;overflow-y:auto">
        <div class="card-head"><h3>Задачи</h3><span class="sub">${tasks.length}</span></div>
        ${list || '<div class="empty"><div class="t">Задач пока нет</div><div class="s">Откройте чат и опишите задачу</div></div>'}
      </div>
      <div class="card" style="max-height:640px;overflow-y:auto">
        ${selected ? taskTimelineHtml(selected) : '<div class="empty"><div class="t">Выберите задачу слева</div></div>'}
      </div>
    </div>`;
  },
  mount(container) {
    bindDelegation(container, { select: (el) => { selectedTaskId = el.getAttribute('data-id'); container.innerHTML = processesScreen.render(); bindJsonToggles(container); } });
    bindJsonToggles(container);
    const repaint = () => { container.innerHTML = processesScreen.render(); bindJsonToggles(container); };
    const offs = ['tasks:update'].map((n) => on(n, repaint));
    return () => offs.forEach((f) => f());
  },
};

// ===================================================================
// TODO
// ===================================================================
const TODO_COLS = [
  { id: 'todo', label: 'К выполнению' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'review', label: 'На проверке' },
  { id: 'rework', label: 'Доработка' },
  { id: 'done', label: 'Готово' },
];

export const todoScreen = {
  id: 'todo', title: 'Todo', subtitle: 'Борды по отделам — заполняются пайплайном в реальном времени',
  render() {
    const boards = store.departments.filter((d) => (store.todos[d.id] || []).length > 0);
    if (!boards.length) {
      return `<div class="content-inner"><div class="empty">${icon.todo}<div class="t">Борды пока пусты</div><div class="s">Запустите задачу в чате — здесь появятся карточки</div></div></div>`;
    }
    return `<div class="content-inner">
      ${boards.map((d) => `
        <div class="section-title"><span class="dept-dot" style="background:${d.color}"></span>${esc(d.name)}</div>
        <div class="kanban" style="margin-bottom:var(--sp-6)">
          ${TODO_COLS.map((col) => {
            const items = (store.todos[d.id] || []).filter((t) => t.status === col.id);
            return `<div class="kcol" data-col="${col.id}" data-dept="${d.id}">
              <div class="kcol-head"><span class="nm">${col.label}</span><span class="badge-count" style="background:var(--stroke)">${items.length}</span></div>
              ${items.map((t) => `<div class="kcard" draggable="true" data-todo="${t.id}" data-dept="${d.id}">
                <div class="t">${esc(t.title)}</div>
                <div class="meta"><span class="chip" style="color:${d.color}">${esc(d.name)}</span></div>
              </div>`).join('')}
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>`;
  },
  mount(container) {
    const repaint = () => { container.innerHTML = todoScreen.render(); wireDrag(); };
    function wireDrag() {
      let draggedId = null, draggedDept = null;
      container.querySelectorAll('.kcard').forEach((card) => {
        card.addEventListener('dragstart', () => { draggedId = card.getAttribute('data-todo'); draggedDept = card.getAttribute('data-dept'); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
      });
      container.querySelectorAll('.kcol').forEach((col) => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
        col.addEventListener('dragleave', () => col.classList.remove('dragover'));
        col.addEventListener('drop', (e) => {
          e.preventDefault(); col.classList.remove('dragover');
          const dept = col.getAttribute('data-dept'), status = col.getAttribute('data-col');
          if (!draggedId || dept !== draggedDept) return;
          const item = (store.todos[dept] || []).find((t) => t.id === draggedId);
          if (item) { item.status = status; repaint(); }
        });
      });
    }
    repaint();
    const off = on('todos:update', repaint);
    return () => off();
  },
};

// ===================================================================
// ПОДТВЕРЖДЕНИЯ
// ===================================================================
export const approvalsScreen = {
  id: 'approvals', title: 'Подтверждения', subtitle: 'Действия, требующие решения человека',
  render() {
    const items = Object.values(store.interactions).filter((i) => i.kind === 'approval');
    if (!items.length) {
      return `<div class="content-inner"><div class="empty">${icon.approvals}<div class="t">Нет ожидающих подтверждений</div><div class="s">Появятся, когда пайплайн дойдёт до отправки результата</div></div></div>`;
    }
    return `<div class="content-inner">${items.map((i) => `
      <div class="approval-card">
        <div class="top"><span class="chip accent">${esc(i.type || 'действие')}</span><span class="muted" style="font-size:11.5px">задача ${esc(i.taskId)}</span></div>
        <div class="summary">${esc(i.summary || '')}</div>
        ${i.artifact ? `<div class="artifact">${esc(i.artifact)}</div>` : ''}
        <div class="actions">
          <button class="btn primary sm" data-action="approve" data-id="${i.id}">${icon.check} Подтвердить</button>
          <button class="btn danger sm" data-action="reject" data-id="${i.id}">${icon.x} Отклонить</button>
        </div>
      </div>`).join('')}</div>`;
  },
  mount(container) {
    bindDelegation(container, {
      approve: async (el) => { await resolveInteraction(el.getAttribute('data-id'), { decision: 'approve' }); },
      reject: async (el) => { await resolveInteraction(el.getAttribute('data-id'), { decision: 'reject' }); },
    });
    const repaint = () => { container.innerHTML = approvalsScreen.render(); };
    const off = on('interactions:update', repaint);
    return () => off();
  },
};
