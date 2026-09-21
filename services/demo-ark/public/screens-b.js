import { store, on, emit, deptById } from './state.js';
import { esc, fmtUsd, fmtTokens, timeAgo, debounce } from './util.js';
import { barChart } from './charts.js';
import { icon } from './icons.js';
import { openDrawer, kv } from './drawer.js';
import { GraphRenderer, treeLayout } from './graph.js';

function bindDelegation(container, map) {
  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    if (map[el.getAttribute('data-action')]) map[el.getAttribute('data-action')](el, e);
  });
}

// ===================================================================
// КЛИЕНТЫ И ВОРОНКА
// ===================================================================
export const clientsScreen = {
  id: 'clients', title: 'Клиенты и воронка',
  get subtitle() { return `${store.clients.length} клиентов · ${store.deals.length} сделок`; },
  render() {
    const rows = store.clients.map((c) => {
      const deals = store.deals.filter((d) => d.clientId === c.id);
      const total = deals.reduce((s, d) => s + d.amountUsd, 0);
      return `<tr><td><b>${esc(c.name)}</b></td><td class="muted">${esc(c.segment)}</td><td class="muted">${esc(c.city)}</td>
        <td class="num">${deals.length}</td><td class="num">${fmtUsd(total)}</td></tr>`;
    }).join('');

    const cols = store.funnelStages.map((s) => {
      const deals = store.deals.filter((d) => d.stage === s.id);
      return `<div class="kcol" data-stage="${s.id}">
        <div class="kcol-head"><span class="dept-dot" style="background:${s.color}"></span><span class="nm">${esc(s.label)}</span>
          <span class="badge-count" style="background:var(--stroke)">${deals.length}</span></div>
        ${deals.map((d) => {
          const cl = store.clients.find((c) => c.id === d.clientId);
          return `<div class="fcard" draggable="true" data-deal="${d.id}">
            <div class="amt num">${fmtUsd(d.amountUsd)}</div>
            <div class="cl">${esc(d.title)}</div>
            <div class="cl muted">${esc(cl ? cl.name : '')}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');

    return `<div class="content-inner">
      <div class="section-title">Воронка</div>
      <div class="funnel" style="margin-bottom:var(--sp-6)">${cols}</div>
      <div class="card">
        <div class="card-head"><h3>Клиенты</h3></div>
        <table class="tbl"><thead><tr><th>Клиент</th><th>Сегмент</th><th>Город</th><th>Сделок</th><th>Сумма</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </div>`;
  },
  mount(container) {
    const repaint = () => { container.innerHTML = clientsScreen.render(); wireDrag(); };
    function wireDrag() {
      let draggedId = null;
      container.querySelectorAll('.fcard').forEach((c) => {
        c.addEventListener('dragstart', () => { draggedId = c.getAttribute('data-deal'); c.classList.add('dragging'); });
        c.addEventListener('dragend', () => c.classList.remove('dragging'));
      });
      container.querySelectorAll('.kcol').forEach((col) => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
        col.addEventListener('dragleave', () => col.classList.remove('dragover'));
        col.addEventListener('drop', (e) => {
          e.preventDefault(); col.classList.remove('dragover');
          const deal = store.deals.find((d) => d.id === draggedId);
          if (deal) { deal.stage = col.getAttribute('data-stage'); repaint(); }
        });
      });
    }
    repaint();
    return () => {};
  },
};

// ===================================================================
// БАЗА ЗНАНИЙ
// ===================================================================
function kbDrawer(node) {
  const dept = node.departmentId ? deptById(node.departmentId) : null;
  let extra = '';
  if (node.type === 'lesson') extra = kv('Уверенность', `${Math.round((node.confidence || 0) * 100)}%`) + kv('Использований', node.uses ?? 0);
  if (node.type === 'entity' && node.fields) extra = Object.entries(node.fields).map(([k, v]) => kv(esc(k), esc(v))).join('');
  openDrawer(node.type, node.title, `
    ${kv('Отдел', dept ? dept.name : '—')}
    ${extra}
  `);
}

export const kbScreen = {
  id: 'kb', title: 'База знаний', subtitle: 'Граф уроков, документов и карточек',
  render() {
    return `<div class="content-inner">
      <div class="hstack" style="margin-bottom:var(--sp-4)">
        <div class="searchbox" style="margin-left:0;max-width:320px" id="kbSearchBox">
          ${icon.search}<input id="kbSearch" placeholder="Поиск по базе знаний…" />
        </div>
      </div>
      <div class="graph-wrap"><canvas id="kbCanvas"></canvas>
        <div class="graph-hint">Клик по узлу — карточка</div>
      </div>
      <div class="card" id="kbResults" style="margin-top:var(--sp-5);display:none"></div>
    </div>`;
  },
  mount(container) {
    const canvas = container.querySelector('#kbCanvas');
    const renderer = new GraphRenderer(canvas, { onNodeClick: (id) => {
      const n = store.kbNodes.find((x) => x.id === id);
      if (n) kbDrawer(n);
    } });
    const parentOf = (n) => (store.kbEdges.find((e) => e.to === n.id && e.type === 'in_topic') || {}).from;
    const positions = treeLayout('root', store.kbNodes, parentOf);
    const typeR = { topic: 20, doc: 13, lesson: 13, entity: 13 };
    const nodes = store.kbNodes.map((n) => {
      const dept = n.departmentId ? deptById(n.departmentId) : null;
      const pos = positions[n.id] || { x: 0.5, y: 0.5 };
      return { id: n.id, x: pos.x, y: pos.y, r: n.id === 'root' ? 24 : (typeR[n.type] || 13),
        color: n.id === 'root' ? 'var(--accent)' : (dept ? dept.color : 'var(--text-3)'),
        label: n.title.length > 22 ? n.title.slice(0, 20) + '…' : n.title, glyph: n.title[0] };
    });
    const edges = store.kbEdges.map((e) => ({ from: e.from, to: e.to, dashed: e.type !== 'in_topic', width: e.type === 'in_topic' ? 1.4 : 1 }));
    renderer.setGraph({ nodes, edges });

    const results = container.querySelector('#kbResults');
    const search = container.querySelector('#kbSearch');
    const doSearch = debounce((q) => {
      q = q.trim().toLowerCase();
      if (!q) { results.style.display = 'none'; return; }
      const hits = store.kbNodes.filter((n) => n.title.toLowerCase().includes(q));
      results.style.display = 'block';
      results.innerHTML = `<div class="card-head"><h3>Найдено: ${hits.length}</h3></div>` +
        (hits.map((n) => `<div class="dept-row" data-kb="${n.id}"><span class="chip">${n.type}</span><span class="nm">${esc(n.title)}</span></div>`).join('') || '<div class="muted">Ничего не найдено</div>');
      results.querySelectorAll('[data-kb]').forEach((el) => el.addEventListener('click', () => {
        const n = store.kbNodes.find((x) => x.id === el.getAttribute('data-kb'));
        if (n) kbDrawer(n);
      }));
    }, 200);
    search.addEventListener('input', () => doSearch(search.value));

    return () => renderer.destroy();
  },
};

// ===================================================================
// СКИЛЛЫ
// ===================================================================
const skillStatusChip = (s) => ({ active: '<span class="chip ok">active</span>', draft: '<span class="chip">draft</span>', review: '<span class="chip warn">review</span>' }[s] || s);

export const skillsScreen = {
  id: 'skills', title: 'Скиллы', subtitle: 'Версионированные инструкции агентов',
  render() {
    const rows = store.skills.map((s) => `
      <tr class="skill-row" data-action="open" data-id="${s.id}">
        <td><b>${esc(s.title)}</b><div class="muted" style="font-size:11px">${esc(s.name)}</div></td>
        <td>${s.departmentIds.map((d) => `<span class="chip" style="color:${deptById(d)?.color || 'inherit'}">${esc(deptById(d)?.name || d)}</span>`).join(' ')}</td>
        <td>${skillStatusChip(s.status)}</td>
        <td class="num muted">v${s.version}</td>
      </tr>`).join('');
    return `<div class="content-inner card">
      <table class="tbl clickable"><thead><tr><th>Скилл</th><th>Отделы</th><th>Статус</th><th>Версия</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  },
  mount(container) {
    bindDelegation(container, { open: (el) => {
      const s = store.skills.find((x) => x.id === el.getAttribute('data-id'));
      if (!s) return;
      openDrawer('скилл', s.title, `
        ${kv('name', s.name)}
        ${kv('Статус', skillStatusChip(s.status))}
        ${kv('Версия', 'v' + s.version)}
        ${kv('Отделы', s.departmentIds.map((d) => deptById(d)?.name || d).join(', '))}
        <div class="section-title" style="margin-top:16px">Инструкция</div>
        <div class="muted" style="font-size:12.5px;line-height:1.6">Markdown-инструкция скилла с примерами использования и списком разрешённых действий коннекторов. Активна ровно одна версия; новая версия проходит через статус review до включения владельцем или администратором.</div>
      `);
    } });
    return () => {};
  },
};

// ===================================================================
// СЕРВИСЫ
// ===================================================================
export const servicesScreen = {
  id: 'services', title: 'Сервисы', subtitle: 'Коннекторы интеграций — статус и подключение',
  render() {
    return `<div class="content-inner grid cols-3">
      ${store.services.map((s) => `
        <div class="card">
          <div class="hstack"><b style="font-size:13.5px">${esc(s.name)}</b><span class="spacer"></span>
            <span class="chip ${s.status === 'ok' ? 'ok' : ''}"><span class="cd"></span>${s.status === 'ok' ? 'подключён' : 'отключён'}</span></div>
          <div class="muted" style="font-size:12px;margin:10px 0 14px">${esc(s.note)}</div>
          <button class="btn sm block ${s.status === 'ok' ? '' : 'primary'}" data-action="toggle" data-id="${s.id}">
            ${s.status === 'ok' ? 'Отключить' : 'Подключить'}</button>
        </div>`).join('')}
    </div>`;
  },
  mount(container) {
    bindDelegation(container, { toggle: (el) => {
      const s = store.services.find((x) => x.id === el.getAttribute('data-id'));
      if (!s) return;
      s.status = s.status === 'ok' ? 'disabled' : 'ok';
      container.innerHTML = servicesScreen.render();
    } });
    return () => {};
  },
};

// ===================================================================
// МОДЕЛИ И РАСХОДЫ
// ===================================================================
export const usageScreen = {
  id: 'usage', title: 'Модели и расходы', subtitle: 'Токены и стоимость по дням, моделям и отделам',
  render() {
    const days = store.usageHistory.slice(-14);
    const bars = days.map((d) => ({ label: d.date.slice(5), value: +d.costUsd.toFixed(3) }));
    const pricing = store.seed.pricingConfig;
    return `<div class="content-inner">
      <div class="grid cols-4" style="margin-bottom:var(--sp-5)">
        <div class="kpi"><div class="lbl">Расход за сессию</div><div class="val num">${fmtUsd(store.sessionCost)}</div></div>
        <div class="kpi"><div class="lbl">Токены (вход)</div><div class="val num">${fmtTokens(store.sessionTokensIn)}</div></div>
        <div class="kpi"><div class="lbl">Токены (выход)</div><div class="val num">${fmtTokens(store.sessionTokensOut)}</div></div>
        <div class="kpi"><div class="lbl">Модель</div><div class="val" style="font-size:16px">${store.aiLive ? esc(store.model) : 'демо-режим'}</div></div>
      </div>
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-head"><h3>Расход по дням, $</h3></div>
        ${barChart(bars, { width: 900, height: 190 })}
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h3>Бюджет по отделам</h3></div>
          ${store.departments.map((d) => {
            const pct = Math.min(100, Math.round(((d.spentUsd || 0) / d.budgetUsdMonth) * 100));
            return `<div style="margin-bottom:14px"><div class="hstack" style="font-size:12.5px"><b>${esc(d.name)}</b><span class="spacer"></span><span class="muted">${fmtUsd(d.spentUsd || 0)} / ${fmtUsd(d.budgetUsdMonth)}</span></div>
              <div class="bar"><i style="width:${pct}%;background:${d.color}"></i></div></div>`;
          }).join('')}
        </div>
        <div class="card">
          <div class="card-head"><h3>Цены DeepSeek</h3><span class="sub">за 1M токенов</span></div>
          ${Object.entries(pricing).map(([model, p]) => `
            <div class="kv"><span class="k">${esc(model)} · вход</span><span class="v">$${p.inputPerM}</span></div>
            <div class="kv"><span class="k">${esc(model)} · выход</span><span class="v">$${p.outputPerM}</span></div>
          `).join('')}
          <div class="muted" style="font-size:11px;margin-top:10px">${Object.values(pricing)[0]?.note || ''}</div>
        </div>
      </div>
    </div>`;
  },
  mount(container) {
    const repaint = () => { container.innerHTML = usageScreen.render(); };
    const offs = ['usage:update', 'departments:update', 'session:update'].map((n) => on(n, repaint));
    return () => offs.forEach((f) => f());
  },
};

// ===================================================================
// ЖУРНАЛ
// ===================================================================
export const auditScreen = {
  id: 'audit', title: 'Журнал', subtitle: 'Действия пользователей и системы',
  render() {
    const rows = store.auditLog.map((a) => `
      <tr><td>${timeAgo(new Date(a.ts).getTime())}</td><td><b>${esc(a.actor)}</b></td><td>${esc(a.action)}</td></tr>`).join('');
    return `<div class="content-inner card">
      <table class="tbl"><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  },
  mount(container) {
    const repaint = () => { container.innerHTML = auditScreen.render(); };
    const off = on('audit:update', repaint);
    return () => off();
  },
};

// ===================================================================
// ПОЛЬЗОВАТЕЛИ И ПРАВА
// ===================================================================
const roleChip = (r) => ({ admin: '<span class="chip danger">admin</span>', owner: '<span class="chip accent">owner</span>', employee: '<span class="chip">employee</span>' }[r] || r);

export const usersScreen = {
  id: 'users', title: 'Пользователи и права', subtitle: 'RBAC: администратор → владелец → сотрудник',
  render() {
    const rows = store.users.map((u) => `
      <tr><td><b>${esc(u.name)}</b></td><td>${roleChip(u.role)}</td>
        <td class="muted">${u.department ? esc(deptById(u.department)?.name || u.department) : '—'}</td>
        <td>${u.totp ? '<span class="chip ok">TOTP ✓</span>' : '<span class="muted">—</span>'}</td>
        <td><span class="chip ${u.status === 'online' ? 'ok' : ''}"><span class="cd"></span>${u.status}</span></td></tr>`).join('');
    return `<div class="content-inner">
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="muted" style="font-size:12.5px;line-height:1.6">Создание аккаунтов: admin создаёт owner, owner создаёт employee. Пароль генерируется, при первом входе — обязательная смена. TOTP обязателен для admin и owner. Доступ по каждому запросу и WS-событию проверяется по правам на отдел/задачу.</div>
      </div>
      <div class="card">
        <table class="tbl"><thead><tr><th>Имя</th><th>Роль</th><th>Отдел</th><th>2FA</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div>`;
  },
  mount() { return () => {}; },
};

// ===================================================================
// НАСТРОЙКИ
// ===================================================================
export const settingsScreen = {
  id: 'settings', title: 'Настройки', subtitle: 'Компания, бюджеты, режим ИИ',
  render() {
    return `<div class="content-inner grid cols-2">
      <div class="card">
        <div class="card-head"><h3>Компания</h3></div>
        ${kv('Название', esc(store.tenant.name))}
        ${kv('Часовой пояс', store.tenant.timezone)}
        ${kv('Режим ИИ', store.aiLive ? `живой · ${esc(store.model)}` : 'демо-сценарии (нет ключа)')}
        <div class="muted" style="font-size:11.5px;margin-top:12px">${esc(store.tenant.note)}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Бюджеты отделов</h3><span class="sub">$/мес, влияет на дашборд</span></div>
        ${store.departments.map((d) => `
          <div style="margin-bottom:14px">
            <div class="hstack" style="font-size:12.5px;margin-bottom:6px"><b>${esc(d.name)}</b><span class="spacer"></span><span class="muted num" id="budgetVal-${d.id}">${fmtUsd(d.budgetUsdMonth)}</span></div>
            <input type="range" min="20" max="400" step="10" value="${d.budgetUsdMonth}" data-budget="${d.id}" style="width:100%" />
          </div>`).join('')}
      </div>
    </div>`;
  },
  mount(container) {
    container.querySelectorAll('[data-budget]').forEach((input) => {
      input.addEventListener('input', () => {
        const d = deptById(input.getAttribute('data-budget'));
        if (!d) return;
        d.budgetUsdMonth = +input.value;
        container.querySelector(`#budgetVal-${d.id}`).textContent = fmtUsd(d.budgetUsdMonth);
      });
      input.addEventListener('change', () => emit('departments:update', {}));
    });
    return () => {};
  },
};

// ===================================================================
// TELEGRAM / MINI APP — визуальный макет (без реального бота)
// ===================================================================
export const telegramScreen = {
  id: 'telegram', title: 'Telegram-бот и Mini App', subtitle: 'Визуальный макет — без реального токена бота',
  render() {
    return `<div class="content-inner">
      <div class="seg" id="tgSeg" style="margin-bottom:var(--sp-5)">
        <div class="thumb" id="tgThumb" style="width:88px"></div>
        <button data-tg="bot" class="on">Бот</button>
        <button data-tg="app">Mini App</button>
      </div>
      <div class="hstack" style="align-items:flex-start;gap:32px;flex-wrap:wrap">
        <div class="phone" id="tgPhone">
          <div class="phone-notch"></div>
          <div class="phone-screen" id="tgScreen"></div>
        </div>
        <div class="card" style="flex:1;min-width:260px">
          <div class="card-head"><h3>Команды бота</h3></div>
          ${kv('/start &lt;код&gt;', 'привязка аккаунта')}
          ${kv('/app', 'кнопка открытия Mini App')}
          ${kv('/status', 'сводка задач и расходов за день')}
          ${kv('/tasks', 'мои задачи')}
          ${kv('текст / голос', 'через чат-пайплайн: оценка → ответ или карточка задачи')}
          <div class="muted" style="font-size:11.5px;margin-top:12px">Это статичный макет интерфейса для демонстрации. В проде — Bot API + Mini App с HMAC-проверкой initData.</div>
        </div>
      </div>
    </div>`;
  },
  mount(container) {
    const botHtml = `
      <div class="tg-head"><div class="av">АЯ</div><div><b style="font-size:13px">Арк ядро</b><div style="font-size:10.5px;opacity:.85">бот</div></div></div>
      <div class="tg-body">
        <div class="tg-msg bot">Здравствуйте! Отправьте /start и код из админки, чтобы привязать аккаунт.</div>
        <div class="tg-msg me">/status</div>
        <div class="tg-msg bot">Сегодня: 2 задачи в работе, 3 выполнено, расход $${(store.sessionCost || 0.4).toFixed(2)}. Ожидают подтверждения: 1.</div>
        <div class="tg-msg bot">Подтвердите отправку КП клиенту «Ёркин Маркет»?
          <div class="tg-inline"><button class="ok">Подтвердить</button><button class="no">Отклонить</button></div>
        </div>
      </div>`;
    const appHtml = `
      <div class="tg-head"><div class="av">АЯ</div><div><b style="font-size:13px">Арк ядро</b><div style="font-size:10.5px;opacity:.85">Mini App</div></div></div>
      <div class="tg-body" style="gap:12px">
        <div class="kpi" style="padding:12px"><div class="lbl">Активные задачи</div><div class="val num" style="font-size:20px">${Object.values(store.tasks).filter((t) => t.status === 'running').length}</div></div>
        <div class="kpi" style="padding:12px"><div class="lbl">Расход сегодня</div><div class="val num" style="font-size:20px">${fmtUsd((store.usageHistory.at(-1) || {}).costUsd || 0)}</div></div>
        <div class="card" style="padding:10px"><div class="muted" style="font-size:11px">Та же сборка SPA, режим ?tg=1 — тема из themeParams, BackButton.</div></div>
      </div>`;
    const screen = container.querySelector('#tgScreen');
    const seg = container.querySelector('#tgSeg');
    const thumb = container.querySelector('#tgThumb');
    screen.innerHTML = botHtml;
    seg.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      thumb.style.transform = i === 1 ? 'translateX(88px)' : 'translateX(0)';
      screen.innerHTML = b.getAttribute('data-tg') === 'bot' ? botHtml : appHtml;
    }));
    return () => {};
  },
};
