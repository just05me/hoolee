// Мелкие переиспользуемые хелперы: экранирование, форматирование, тосты, JSON-вьюер.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtUsd(v) {
  if (v == null) return '—';
  v = Number(v);
  if (v > 0 && v < 0.01) return '$' + v.toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return '$' + v.toLocaleString('ru-RU', { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: 2 });
}

export function fmtTokens(v) {
  if (v == null) return '—';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

export function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + ' мс';
  return (ms / 1000).toFixed(1) + ' с';
}

export function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return 'только что';
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн назад`;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- toasts ----------
let toastWrap = null;
export function toast(text, { kind = 'info', icon = '' } = {}) {
  if (!toastWrap) toastWrap = document.getElementById('toasts');
  if (!toastWrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const dotColor = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', info: 'var(--accent)' }[kind] || 'var(--accent)';
  el.innerHTML = `<span class="cd" style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex:none"></span><span>${esc(text)}</span>`;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  }, 4200);
}

// ---------- JSON viewer (для шагов процесса) ----------
function highlightJson(obj) {
  const json = JSON.stringify(obj, null, 2);
  return esc(json)
    .replace(/&quot;([^&]*?)&quot;(:?)/g, (m, key, colon) =>
      colon ? `<span class="jk">&quot;${key}&quot;</span>:` : `<span class="js-str">&quot;${key}&quot;</span>`)
    .replace(/: (-?\d+(\.\d+)?)/g, ': <span class="js-num">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="js-bool">$1</span>');
}

let jsonViewSeq = 0;
export function jsonViewer(obj, label = 'JSON') {
  if (obj == null) return '';
  const id = `jv_${++jsonViewSeq}`;
  return `<div class="json-toggle" data-jv-toggle="${id}">${window.__icon_chevron || ''}<span>${esc(label)}</span></div>
    <div class="json-view" id="${id}">${highlightJson(obj)}</div>`;
}

export function bindJsonToggles(root = document) {
  root.querySelectorAll('[data-jv-toggle]').forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-jv-toggle');
      const view = document.getElementById(id);
      if (!view) return;
      const open = view.classList.toggle('open');
      el.classList.toggle('open', open);
    });
  });
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
