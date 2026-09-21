(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.replace('no-js', 'js');
  const nav = document.querySelector('#nav');
  const burger = document.querySelector('#burger');
  function closeMenu(returnFocus = false) {
    nav.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    if (returnFocus) burger.focus();
  }
  burger.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    if (open) nav.querySelector('a').focus();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(true); });
  document.addEventListener('click', e => { if (!e.target.closest('#hdr')) closeMenu(); });
  nav.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  document.addEventListener('focusin', e => { if (!e.target.closest('#hdr')) closeMenu(); });
  matchMedia('(min-width: 761px)').addEventListener('change', () => closeMenu());
  const themeButton = document.querySelector('.theme-btn');
  function setTheme(theme) {
    root.dataset.theme = theme;
    themeButton.setAttribute('aria-pressed', String(theme === 'light'));
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f5f5f7' : '#08090b';
  }
  setTheme(root.dataset.theme || 'dark');
  themeButton.addEventListener('click', () => {
    const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(theme);
    try { localStorage.setItem('arcoai-theme', theme); } catch (_) {}
  });
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); }
    }), { threshold: 0.05 });
    document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));
  }
  document.querySelectorAll('form.lead').forEach(form => {
    const status = form.querySelector('.status');
    let busy = false;
    function validate() {
      let first;
      ['name', 'contact', 'message'].forEach(name => {
        const field = form.elements[name], invalid = !field.value.trim();
        field.closest('.fld').classList.toggle('bad', invalid);
        field.setAttribute('aria-invalid', String(invalid));
        if (invalid) { field.setAttribute('aria-describedby', status.id); first ||= field; }
        else field.removeAttribute('aria-describedby');
      });
      if (first) { status.className = 'status err'; status.textContent = form.dataset.required; first.focus(); return false; }
      return true;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !validate()) return;
      const data = Object.fromEntries(new FormData(form));
      data.lang = form.dataset.lang; data.page = form.dataset.page;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      busy = true; form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('[data-send]').forEach(button => button.disabled = true);
      status.className = 'status'; status.textContent = form.dataset.sending;
      try {
        const response = await fetch(form.dataset.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok || result.dryRun) throw new Error('delivery failed');
        status.className = 'status ok'; status.textContent = form.dataset.ok; form.reset();
      } catch (_) {
        status.className = 'status err'; status.textContent = form.dataset.err;
      } finally {
        clearTimeout(timeout); busy = false; form.removeAttribute('aria-busy');
        form.querySelectorAll('[data-send]').forEach(button => button.disabled = false);
      }
    });
    form.querySelector('[data-send="email"]')?.addEventListener('click', () => {
      if (!validate()) return;
      const v = Object.fromEntries(new FormData(form));
      const body = [v.name, v.company, v.contact, '', v.message].join('\n');
      window.location.href = 'mailto:' + form.dataset.email + '?subject=' + encodeURIComponent(form.dataset.subject) + '&body=' + encodeURIComponent(body);
    });
    form.querySelectorAll('input,textarea').forEach(field => field.addEventListener('input', () => {
      field.closest('.fld')?.classList.remove('bad');
      field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby');
    }));
  });
})();
