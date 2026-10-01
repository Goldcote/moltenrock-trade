// Progressive enhancement only — every page works without JavaScript.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (btn) {
    const el = document.getElementById(btn.getAttribute('data-copy'));
    if (el && navigator.clipboard) {
      navigator.clipboard.writeText(el.textContent.trim()).then(() => {
        const old = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = old; }, 1200);
      });
    }
  }
  if (e.target.closest('[data-print]')) { window.print(); return; }
  const confirmBtn = e.target.closest('[data-confirm]');
  if (confirmBtn && !window.confirm(confirmBtn.getAttribute('data-confirm'))) e.preventDefault();
});

// Live panels: re-fetch server-rendered fragments while the page is visible; new rows glow once.
document.querySelectorAll('[data-poll]').forEach((el) => {
  const every = el.hasAttribute('data-poll-fast') ? 5000 : 9000;
  setInterval(() => {
    if (document.hidden) return;
    fetch(el.getAttribute('data-poll'), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : null))
      .then((h) => {
        if (h === null || h === el.innerHTML) return;
        const seen = new Set([...el.querySelectorAll('[data-id]')].map((n) => n.getAttribute('data-id')));
        el.innerHTML = h;
        if (seen.size) el.querySelectorAll('[data-id]').forEach((n) => { if (!seen.has(n.getAttribute('data-id'))) n.classList.add('fresh'); });
      })
      .catch(() => {});
  }, every);
});

const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Numbers count up once they scroll into view (the server already rendered the final value).
const counters = document.querySelectorAll('[data-count]');
if (counters.length && !calm && 'IntersectionObserver' in window) {
  const fmt = (el, v) => {
    const locale = el.getAttribute('data-locale') || 'de-CH';
    return el.getAttribute('data-fmt') === 'money'
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'CHF', minimumFractionDigits: 2 }).format(v / 100)
      : new Intl.NumberFormat(locale).format(Math.round(v));
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target, target = Number(el.getAttribute('data-count')) || 0, t0 = performance.now(), dur = 1300;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur), eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        el.textContent = fmt(el, el.getAttribute('data-fmt') === 'money' ? Math.round(target * eased) : target * eased);
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = fmt(el, 0);
      requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });
  counters.forEach((el) => io.observe(el));
}

// Cursor spotlight on cards.
if (!calm) {
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest && e.target.closest('[data-spot]');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}
