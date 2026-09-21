// Плавающая панель чата — главный вход в мультиагентный цикл.
// Строит свою разметку сама и вешается на body; общается со state.js через bus.

import { store, on, startTask, resolveInteraction, deptById } from './state.js';
import { esc, uid, toast } from './util.js';
import { icon } from './icons.js';

let unread = 0;
let panelOpen = false;
let feed = []; // {id, role, html}

function levelLabel(l) {
  return { simple: 'простой вопрос', medium: 'одна задача', complex: 'несколько отделов', out_of_scope: 'вне текущих отделов' }[l] || l;
}
function verdictLabel(v) {
  return { accept: 'принято ✅', rework: 'на доработку', escalate: 'эскалировано к человеку', pass: 'пройдено', reject: 'отклонено' }[v] || v;
}
function deptName(id) { return deptById(id)?.name || id; }

function stepToText(name, data) {
  switch (name) {
    case 'task_triaged': {
      const r = data.result;
      if (!r) return null;
      const depts = (r.departments || []).map(deptName).join(', ');
      return `🔍 Первичная оценка: <b>${levelLabel(r.level)}</b>${depts ? ' · ' + esc(depts) : ''} (увер. ${Math.round((r.confidence || 0) * 100)}%)`;
    }
    case 'dept_created':
      return `🏗️ Создан временный отдел «${esc(data.department.name)}» — задача вне текущей структуры`;
    case 'plan_created': {
      const blocks = data.plan?.blocks || [];
      return `🗂️ План готов: ${blocks.length} блок(ов) — ${esc(blocks.map((b) => deptName(b.department)).join(', '))}`;
    }
    case 'work_result': {
      const ok = data.result?.status === 'done';
      return `${ok ? '⚙️' : '⛔'} ${esc(deptName(data.department))}: блок ${ok ? 'готов' : 'заблокирован'}`;
    }
    case 'acceptance_verdict':
      return data.result ? `🏁 Приём: ${verdictLabel(data.result.verdict)}` : null;
    case 'task_escalated':
      return `⚠️ Эскалировано к человеку: ${esc(data.reason || '')}`;
    case 'error':
      return `⚠️ ${esc(data.message || 'Ошибка')}`;
    default:
      return null;
  }
}

function bubble(role, html) {
  return { id: uid('m'), role, html };
}

function render() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;
  const body = panel.querySelector('.chat-body');
  const wasAtBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
  body.innerHTML = feed.map((m) => {
    if (m.role === 'system') return `<div class="msg system">${m.html}</div>`;
    return `<div class="msg ${m.role}">${m.html}</div>`;
  }).join('') || `<div class="msg system">Опишите задачу или выберите пример ниже — увидите весь цикл агентов вживую.</div>`;
  if (wasAtBottom) body.scrollTop = body.scrollHeight;
  document.getElementById('chatBadge')?.remove();
  const launcher = document.getElementById('chatLauncher');
  if (unread > 0 && !panelOpen && launcher) {
    const b = document.createElement('span');
    b.className = 'badge-count'; b.id = 'chatBadge'; b.textContent = String(unread);
    launcher.appendChild(b);
  }
}

function pushBot(html) {
  feed.push(bubble('bot', html));
  if (!panelOpen) unread++;
  render();
}

function pushUser(text) {
  feed.push(bubble('user', esc(text)));
  render();
}

function pushInteraction(taskId, interaction) {
  const id = `itx_${interaction.id}`;
  if (interaction.kind === 'clarification') {
    const q = (interaction.questions || []).join(' ');
    feed.push(bubble('bot', `❓ ${esc(q)}
      <div class="itx-card" id="${id}">
        <input class="itx-input" placeholder="Ваш ответ…" />
        <div class="itx-row"><button class="btn primary sm block" data-itx-answer="${interaction.id}">Ответить</button></div>
      </div>`));
  } else {
    feed.push(bubble('bot', `✋ Нужно подтверждение: ${esc(interaction.summary || 'отправить результат клиенту?')}
      <div class="art">${esc((interaction.artifact || '').slice(0, 400))}</div>
      <div class="itx-card" id="${id}">
        <div class="itx-row">
          <button class="btn primary sm" style="flex:1" data-itx-approve="${interaction.id}">${icon.check} Подтвердить</button>
          <button class="btn danger sm" style="flex:1" data-itx-reject="${interaction.id}">${icon.x} Отклонить</button>
        </div>
      </div>`));
  }
  if (!panelOpen) unread++;
  render();
  wireInteractionButtons();
}

function wireInteractionButtons() {
  document.querySelectorAll('[data-itx-approve]').forEach((btn) => {
    if (btn.dataset.bound) return; btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-itx-approve');
      btn.closest('.itx-card').innerHTML = '<span class="muted">Подтверждено ✓</span>';
      await resolveInteraction(id, { decision: 'approve' });
    });
  });
  document.querySelectorAll('[data-itx-reject]').forEach((btn) => {
    if (btn.dataset.bound) return; btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-itx-reject');
      btn.closest('.itx-card').innerHTML = '<span class="muted">Отклонено</span>';
      await resolveInteraction(id, { decision: 'reject' });
    });
  });
  document.querySelectorAll('[data-itx-answer]').forEach((btn) => {
    if (btn.dataset.bound) return; btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-itx-answer');
      const card = btn.closest('.itx-card');
      const val = card.querySelector('input').value.trim();
      card.innerHTML = `<span class="muted">Ответ отправлен ✓</span>`;
      await resolveInteraction(id, { answers: val });
    });
  });
}

function typingOn() {
  const body = document.querySelector('#chatPanel .chat-body');
  if (!body || document.getElementById('typingRow')) return;
  const row = document.createElement('div');
  row.className = 'msg bot'; row.id = 'typingRow';
  row.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
}
function typingOff() { document.getElementById('typingRow')?.remove(); }

function send(text) {
  if (!text.trim()) return;
  pushUser(text);
  typingOn();
  const off = on('chat:step', (e) => {
    if (e.detail.taskId !== currentTaskId) return;
    typingOff();
    const html = stepToText(e.detail.name, e.detail.data);
    if (html) pushBot(html);
    if (e.detail.name === 'task_done') {
      const d = e.detail.data;
      const showArtifact = d.artifact && d.artifact !== d.summary;
      pushBot(`✅ ${esc(d.summary || 'Готово')}${showArtifact ? `<div class="art">${esc(d.artifact)}</div>` : ''}`);
    }
    const terminal = ['task_done', 'task_escalated', 'error'].includes(e.detail.name);
    if (terminal) { off(); offItx(); } else { typingOn(); }
  });
  const offItx = on('chat:interaction', (e) => {
    if (e.detail.taskId !== currentTaskId) return;
    typingOff();
    pushInteraction(e.detail.taskId, e.detail.interaction);
    typingOn();
  });
  currentTaskId = startTask(text);
}
let currentTaskId = null;

function openPanel(open) {
  panelOpen = open;
  document.getElementById('chatPanel')?.classList.toggle('show', open);
  if (open) { unread = 0; render(); }
}

export function initChat() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button class="chat-launcher" id="chatLauncher" aria-label="Чат">${icon.chat}</button>
    <div class="chat-panel" id="chatPanel">
      <div class="chat-head">
        <div class="avatar" style="width:30px;height:30px;border-radius:9px;font-size:11px">АЯ</div>
        <div><div class="nm">Ассистент «Арк ядро»</div><div class="st" id="chatAiState">…</div></div>
        <button class="iconbtn close-x sm" id="chatClose" style="margin-left:auto;width:32px;height:32px">${icon.close}</button>
      </div>
      <div class="chat-body"></div>
      <div class="chat-quick" id="chatQuick"></div>
      <div class="chat-input-row">
        <button class="mic-btn" id="chatMic" data-tip="Голосовой ввод (демо-заглушка)">${icon.mic}</button>
        <textarea id="chatInput" rows="1" placeholder="Опишите задачу…"></textarea>
        <button class="send-btn" id="chatSend">${icon.send}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  document.getElementById('chatAiState').textContent = store.aiLive
    ? `Живой ИИ · DeepSeek (${store.model})` : 'Демо-режим · сценарии без ключа';

  const quick = document.getElementById('chatQuick');
  quick.innerHTML = store.quickPrompts.map((q) => `<div class="qchip" data-q="${q.id}">${esc(q.text.slice(0, 42))}${q.text.length > 42 ? '…' : ''}</div>`).join('');
  quick.querySelectorAll('.qchip').forEach((el) => {
    el.addEventListener('click', () => {
      const q = store.quickPrompts.find((x) => x.id === el.getAttribute('data-q'));
      if (q) { document.getElementById('chatInput').value = q.text; openPanel(true); send(q.text); document.getElementById('chatInput').value = ''; }
    });
  });

  document.getElementById('chatLauncher').addEventListener('click', () => openPanel(!panelOpen));
  document.getElementById('chatClose').addEventListener('click', () => openPanel(false));
  document.getElementById('chatMic').addEventListener('click', () => toast('Голосовой ввод — заглушка демо. В проде: Yandex SpeechKit → /chat/stt.', { kind: 'info' }));

  const input = document.getElementById('chatInput');
  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    openPanel(true);
    send(text);
    input.value = '';
    input.style.height = 'auto';
  };
  document.getElementById('chatSend').addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(100, input.scrollHeight) + 'px'; });

  render();
}

export function openChatWithText(text) {
  openPanel(true);
  document.getElementById('chatInput').value = text;
}
