import * as state from './state.js';
import { store, on, emit } from './state.js';
import { icon } from './icons.js';
import { esc, toast, bindJsonToggles } from './util.js';
import { closeDrawer } from './drawer.js';
import { initChat, openChatWithText } from './chat.js';
import {
  dashboardScreen, orgScreen, processesScreen, todoScreen, approvalsScreen,
} from './screens-a.js';
import {
  clientsScreen, kbScreen, skillsScreen, servicesScreen, usageScreen, auditScreen, usersScreen, settingsScreen, telegramScreen,
} from './screens-b.js';

const ICONS = {
  dashboard: icon.dashboard, org: icon.org, processes: icon.process, todo: icon.todo,
  approvals: icon.approvals, clients: icon.clients, kb: icon.kb, skills: icon.skills,
  services: icon.services, usage: icon.usage, audit: icon.audit, users: icon.users,
  settings: icon.settings, telegram: icon.telegram,
};

const NAV_GROUPS = [
  { title: 'Обзор', items: [dashboardScreen, orgScreen] },
  { title: 'Работа', items: [processesScreen, todoScreen, approvalsScreen, clientsScreen] },
  { title: 'Данные', items: [kbScreen, skillsScreen, servicesScreen, usageScreen] },
  { title: 'Система', items: [auditScreen, usersScreen, settingsScreen, telegramScreen] },
];
const ALL_SCREENS = NAV_GROUPS.flatMap((g) => g.items);

let currentScreen = null;
let currentDispose = null;

function badgeFor(id) {
  if (id === 'approvals') {
    const n = Object.values(store.interactions).filter((i) => i.kind === 'approval').length;
    return n || null;
  }
  if (id === 'todo') {
    const n = Object.values(store.todos).flat().filter((t) => t.status !== 'done').length;
    return n || null;
  }
  if (id === 'processes') {
    const n = state.sortedTasks().filter((t) => t.status === 'running').length;
    return n || null;
  }
  return null;
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV_GROUPS.map((g) => `
    <div class="nav-group-title">${g.title}</div>
    ${g.items.map((s) => {
      const b = badgeFor(s.id);
      return `<div class="nav-item ${currentScreen === s.id ? 'on' : ''}" data-nav="${s.id}">
        ${ICONS[s.id]}<span>${s.title}</span>${b ? `<span class="badge-count">${b}</span>` : ''}
      </div>`;
    }).join('')}
  `).join('');
  nav.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => {
    navigate(el.getAttribute('data-nav'));
    document.getElementById('sidebar').classList.remove('open');
  }));
}

function navigate(id) {
  const screen = ALL_SCREENS.find((s) => s.id === id) || dashboardScreen;
  if (currentDispose) { currentDispose(); currentDispose = null; }
  currentScreen = screen.id;
  document.getElementById('pageTitle').textContent = screen.title;
  document.getElementById('pageSub').textContent = screen.subtitle;
  const content = document.getElementById('content');
  content.innerHTML = screen.render();
  bindJsonToggles(content);
  currentDispose = screen.mount ? screen.mount(content) : null;
  renderNav();
  closeDrawer();
}

// ---------- theme ----------
function applyThemeSeg() {
  const seg = document.getElementById('themeSeg');
  const thumb = document.getElementById('themeThumb');
  const saved = localStorage.getItem('ark-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved === 'auto' ? '' : saved);
  if (saved === 'auto') document.documentElement.removeAttribute('data-theme');
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.theme === saved));
  positionThumb(seg, thumb);
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.theme;
    localStorage.setItem('ark-theme', v);
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    positionThumb(seg, thumb);
  }));
}
function positionThumb(seg, thumb) {
  const on = seg.querySelector('button.on');
  if (!on) return;
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft - 3}px)`;
}

// ---------- command palette ----------
function initCmdk() {
  const scrim = document.getElementById('cmdkScrim');
  const input = document.getElementById('cmdkInput');
  const list = document.getElementById('cmdkList');

  function items(q) {
    q = q.trim().toLowerCase();
    const screens = ALL_SCREENS.map((s) => ({ kind: 'screen', id: s.id, label: s.title, icon: ICONS[s.id] }));
    const prompts = store.quickPrompts.map((p) => ({ kind: 'prompt', id: p.id, label: p.text, icon: icon.chat }));
    const all = [...screens, ...prompts];
    if (!q) return all.slice(0, 8);
    return all.filter((it) => it.label.toLowerCase().includes(q)).slice(0, 8);
  }
  function paint() {
    const its = items(input.value);
    list.innerHTML = its.map((it, i) => `
      <div class="cmdk-item ${i === 0 ? 'on' : ''}" data-k="${it.kind}" data-id="${it.id}">
        ${it.icon}<span>${esc(it.label)}</span><span class="grp">${it.kind === 'screen' ? 'экран' : 'пример'}</span>
      </div>`).join('') || '<div class="cmdk-item"><span class="muted">Ничего не найдено</span></div>';
    list.querySelectorAll('.cmdk-item[data-id]').forEach((el) => el.addEventListener('click', () => choose(el)));
  }
  function choose(el) {
    const kind = el.getAttribute('data-k'), id = el.getAttribute('data-id');
    close();
    if (kind === 'screen') navigate(id);
    else { const p = store.quickPrompts.find((x) => x.id === id); if (p) openChatWithText(p.text); }
  }
  function open() { scrim.classList.add('show'); input.value = ''; paint(); setTimeout(() => input.focus(), 30); }
  function close() { scrim.classList.remove('show'); }

  document.getElementById('cmdkOpen')?.addEventListener('click', open);
  document.querySelector('.searchbox').addEventListener('click', open);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { const first = list.querySelector('.cmdk-item[data-id]'); if (first) choose(first); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    if (e.key === 'Escape') { close(); closeDrawer(); }
  });
}

// ---------- boot ----------
async function boot() {
  try {
    await state.init();
  } catch (e) {
    console.error('Не удалось загрузить демо:', e);
    const loginWrap = document.getElementById('loginWrap');
    loginWrap.innerHTML = `<div class="login-card" style="text-align:center">
      <h1>Не удалось загрузить демо</h1>
      <div class="login-sub" style="margin-bottom:0">Сервер не ответил или отдал битые данные.<br>
      Проверьте, что запущен <code>python3 server.py</code>, и обновите страницу.</div>
    </div>`;
    return;
  }

  const demoPill = document.getElementById('demoPill');
  const demoLabel = document.getElementById('demoLabel');
  demoPill.classList.toggle('live', store.aiLive);
  demoPill.classList.toggle('canned', !store.aiLive);
  demoLabel.textContent = store.aiLive ? `Живой ИИ · DeepSeek` : 'Демо-режим (без ключа)';
  demoPill.setAttribute('data-tip', store.aiLive
    ? `Модель: ${store.model}. Все роли агентов реально вызывают DeepSeek API.`
    : 'Нет DEEPSEEK_API_KEY в .env — работают заранее прописанные сценарии. См. README.');

  const costPill = document.getElementById('costPill');
  const updateCost = () => { costPill.innerHTML = `${icon.cost}<b>$${store.sessionCost.toFixed(4)}</b>`; };
  updateCost();
  on('session:update', updateCost);

  document.getElementById('userCardName').textContent = store.users[0]?.name || 'Азиз Р.';
  document.getElementById('tenantSub').textContent = `${store.tenant.name} · ${store.tenant.sub}`;

  applyThemeSeg();
  initCmdk();

  document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  document.getElementById('scrim').addEventListener('click', closeDrawer);
  document.getElementById('bellBtn').addEventListener('click', () => {
    const last = store.auditLog[0];
    toast(last ? `${last.actor}: ${last.action}` : 'Нет новых уведомлений', { kind: 'info' });
  });

  on('interactions:update', renderNav);
  on('todos:update', renderNav);
  on('tasks:update', renderNav);

  navigate('dashboard');

  // ---------- login ----------
  const loginWrap = document.getElementById('loginWrap');
  const app = document.getElementById('app');
  document.getElementById('lg-btn').addEventListener('click', () => {
    loginWrap.style.opacity = '0';
    loginWrap.style.pointerEvents = 'none';
    app.classList.add('ready');
    setTimeout(() => { loginWrap.style.display = 'none'; }, 400);
    initChat();
    toast(`Добро пожаловать, ${store.users[0]?.name || 'Азиз Р.'}`, { kind: 'ok' });
  });
}

boot();
