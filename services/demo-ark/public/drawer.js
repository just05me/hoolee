// Боковая панель деталей (сущность/задача/отдел) — один DOM-узел на всё приложение,
// определён в index.html, сюда только логика открытия/закрытия и рендера содержимого.

export function openDrawer(tag, title, bodyHtml) {
  document.getElementById('drawerTag').textContent = tag;
  document.getElementById('drawerTitle').textContent = title;
  document.getElementById('drawerBody').innerHTML = bodyHtml;
  document.getElementById('drawer').classList.add('show');
  document.getElementById('scrim').classList.add('show');
}

export function closeDrawer() {
  document.getElementById('drawer').classList.remove('show');
  document.getElementById('scrim').classList.remove('show');
}

export function kv(k, v) {
  return `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}
