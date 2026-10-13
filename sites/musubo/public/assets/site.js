/* musubo service site — no tracking, no network requests, no storage. */
/* Every page: mobile menu, footer year, legal-page table of contents. */
(() => {
  /* ---------- Mobile menu ---------- */
  const btn = document.querySelector('.menu-btn');
  const menu = document.getElementById('mobile-nav');
  if (btn && menu) {
    const setOpen = (open) => {
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
      menu.hidden = !open;
    };
    btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('.site-header')) setOpen(false);
    });
    window.matchMedia('(min-width: 961px)').addEventListener('change', (m) => { if (m.matches) setOpen(false); });
  }

  /* ---------- Current year in the footer ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  /* ---------- Legal pages: table of contents ---------- */
  const toc = document.querySelector('.toc details');
  if (toc) {
    const narrow = window.matchMedia('(max-width: 900px)');
    const sync = () => { toc.open = !narrow.matches; };
    sync();
    narrow.addEventListener('change', sync);
    toc.addEventListener('click', (e) => { if (e.target.closest('a') && narrow.matches) toc.open = false; });

    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          links.forEach((a) => a.classList.remove('on'));
          const a = map.get(en.target.id);
          if (a) a.classList.add('on');
        });
      }, { rootMargin: '-120px 0px -65% 0px' });
      map.forEach((_, id) => { const sec = document.getElementById(id); if (sec) io.observe(sec); });
    }
  }
})();

/* Top page: admin-tour mock, scaling of the fixed-size mocks, scroll-drawn ribbon. */
(() => {
  const tourEl = document.getElementById('tourData');
  if (!tourEl) return; // top page only
  const tourData = JSON.parse(tourEl.textContent);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  // CSP (style-src 'self') blocks style attributes in markup; apply them through CSSOM instead.
  const applyStyles = (root) => root.querySelectorAll('[data-style]').forEach((el) => { el.style.cssText = el.dataset.style; el.removeAttribute('data-style'); });

  /* ---------- Chrome window chrome (tab bar + URL bar) ---------- */
  const scoop = (side) => `<svg class="scoop ${side}" width="8" height="10" viewBox="0 0 8 10"><path d="M0 10C2 9 6 8 8 0V10H0Z" fill="#35363a"/></svg>`;
  document.querySelectorAll('[data-chrome]').forEach((win) => {
    win.insertAdjacentHTML('afterbegin', `
      <div class="chrome-tabs">
        <div class="chrome-lights"><i data-style="background:#ff5f57"></i><i data-style="background:#febc2e"></i><i data-style="background:#28c840"></i></div>
        <div class="chrome-tabrow"><div class="chrome-tab">${scoop('l')}${scoop('r')}<div class="fav"></div><span>musubo 管理画面</span></div></div>
      </div>
      <div class="chrome-toolbar">
        <div class="chrome-icon"><i></i></div>
        <div class="chrome-url"><i></i><span data-url>${esc(win.dataset.chrome)}</span></div>
        <div class="chrome-icon"><i></i></div>
      </div>`);
    applyStyles(win);
  });

  /* ---------- Admin tour ---------- */
  const co = (n, cls = '') => (n ? `<span class="co ${cls}">${n}</span>` : '');
  const tourMenu = $('tourMenu');
  const btn = (t, i) => `<button class="tour-btn" data-i="${i}" aria-pressed="false"><span class="no">${pad2(i + 1)}</span>${esc(t.name)}<span class="sub">${esc(t.sub)}</span></button>`;
  tourMenu.innerHTML = '<div class="grp">基本の機能</div>' + tourData.slice(0, 5).map((t, i) => btn(t, i)).join('')
    + '<div class="grp warm">musuboならでは</div>' + tourData.slice(5).map((t, i) => btn(t, i + 5)).join('');
  tourMenu.addEventListener('click', (e) => {
    const b = e.target.closest('.tour-btn');
    if (b) renderTour(Number(b.dataset.i));
  });

  function renderTour(ti) {
    const t = tourData[ti];
    tourMenu.querySelectorAll('.tour-btn').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === ti)));
    $('tourChrome').querySelector('[data-url]').textContent = t.url;

    const nav = tourData.map((n, i) => {
      const on = i === ti;
      return `<div data-style="padding:7px 10px;border-radius:8px;font-size:12px;background:${on ? '#E6F2EB' : 'transparent'};color:${on ? '#0F6B44' : '#374151'};font-weight:${on ? 700 : 400}">${esc(n.name)}</div>`;
    }).join('');

    const fields = t.fields ? `<div class="panel" data-style="padding:6px 18px">${t.fields.map((f) =>
      `<div class="t-field">${co(f.co, 'field')}<span class="k">${esc(f.k)}</span><span class="v">${esc(f.v)}</span></div>`).join('')}</div>` : '';

    const rows = t.rows ? `<div class="panel">
      <div class="t-row head"><span>${esc(t.cols.a)}</span><span>${esc(t.cols.b)}</span><span>${esc(t.cols.c)}</span><span data-style="width:76px"></span></div>
      ${t.rows.map((r) => `<div class="t-row">${co(r.co)}<span data-style="font-weight:600">${esc(r.a)}</span><span data-style="color:#374151">${esc(r.b)}</span><span data-style="color:#6B7280">${esc(r.c)}</span><span class="t-status" data-style="background:${r.sbg};color:${r.sc}">${esc(r.s)}</span></div>`).join('')}
    </div>` : '';

    const cards = t.cards ? `<div class="t-cards">${t.cards.map((c) =>
      `<div class="panel t-card">${co(c.co)}<div class="img" data-style="background:${c.bg}"></div><div data-style="font-weight:700">${esc(c.t)}</div><div class="d">${esc(c.d)}</div></div>`).join('')}</div>` : '';

    const notice = t.notice ? `<div class="t-notice">${co(t.noticeCo)}${esc(t.notice)}</div>` : '';

    $('tourScreen').innerHTML = `
      <div class="admin" data-style="grid-template-columns:200px minmax(0,1fr)">
        <div class="admin-side" data-style="padding:14px 10px">
          <div class="admin-brand" data-style="gap:8px;padding:4px 8px 14px"><span class="mark" data-style="width:30px;height:30px;--mk1:#fff;--mk2:#BFEBD3"><svg width="18" height="18"><use href="#mk"/></svg></span><div><div class="n" data-style="font-size:14px">musubo</div><div class="s" data-style="font-size:10px">サンプル店舗</div></div></div>
          ${nav}
        </div>
        <div data-style="display:flex;flex-direction:column;min-width:0;position:relative">
          <div class="admin-top" data-style="padding:10px 22px"><div class="crumb">ホーム › <b>${esc(t.name)}</b></div><span data-style="padding:5px 10px;border:1px solid #E5E7EB;border-radius:8px;font-size:11px">Shed Products株式会社 ⌄</span></div>
          <div data-style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;flex:1;min-height:0">
            <div data-style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div><div data-style="font-size:19px;font-weight:700;color:#143E34">${esc(t.title)}</div><div data-style="font-size:12px;color:#6B7280;margin-top:4px">${esc(t.lead)}</div></div>
              <span class="t-action">${co(t.actionCo)}${esc(t.action)}</span>
            </div>
            ${fields}${rows}${cards}${notice}
          </div>
        </div>
      </div>`;

    applyStyles($('tourScreen'));
    $('tourCallouts').innerHTML = t.callouts.map((c) =>
      `<div class="callout"><span class="n">${c.n}</span><div><div class="t">${esc(c.t)}</div><div class="d">${esc(c.d)}</div></div></div>`).join('');
  }
  renderTour(0);

  /* ---------- Scale fixed-size mocks to their container ---------- */
  const fits = [...document.querySelectorAll('[data-fit]')];
  function measure() {
    fits.forEach((el) => {
      const w = Number(el.dataset.w), h = Number(el.dataset.h);
      const s = Math.min(1, el.clientWidth / w);
      el.style.aspectRatio = `${w} / ${h}`;
      el.firstElementChild.style.transform = `scale(${s})`;
    });
  }

  /* ---------- Ribbon: one path woven through [data-rib] waypoints, drawn as you scroll ---------- */
  const page = $('page'), main = $('rbMain'), flow = $('rbFlow'), svg = $('ribbon'), grad = $('rbG');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let L = 0, H = 0, samples = null, cur = 0;

  function build() {
    const W = page.clientWidth, h = page.scrollHeight;
    if (!W || !h) return;
    svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
    grad.setAttribute('y2', h);
    const pr = page.getBoundingClientRect();
    const pts = [{ x: W * 0.78, y: -120 }];
    document.querySelectorAll('[data-rib]').forEach((el) => {
      const r = el.getBoundingClientRect();
      el.dataset.rib.split(';').forEach((pair) => {
        const [sx, sy] = pair.split(',').map(Number);
        pts.push({ x: W * sx, y: r.top - pr.top + r.height * sy });
      });
    });
    const end = $('rbEnd');
    const er = end.getBoundingClientRect();
    pts.push({ x: W * 0.5, y: er.top - pr.top + er.height / 2 });

    // Catmull-Rom → cubic bezier: smooth tangents through every waypoint
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    main.setAttribute('d', d);
    flow.setAttribute('d', d);
    const sw = Math.max(44, Math.min(104, W * 0.07));
    main.setAttribute('stroke-width', sw);
    flow.setAttribute('stroke-width', Math.max(3, sw * 0.06));
    L = main.getTotalLength();
    main.style.strokeDasharray = `${L} ${L}`;
    const N = 800;
    samples = [];
    for (let i = 0; i <= N; i++) { const len = (L * i) / N; samples.push({ len, y: main.getPointAtLength(len).y }); }
    H = h;
  }

  function tick() {
    if (samples) {
      if (Math.abs(page.scrollHeight - H) > 4) build();
      const vh = window.innerHeight || 800;
      const targetY = -page.getBoundingClientRect().top + vh * 0.9;
      let target = L;
      if (!reduced) {
        const s = samples.find((p) => p.y >= targetY);
        target = s ? s.len : L;
      }
      cur += (target - cur) * 0.06;
      main.style.strokeDashoffset = L - cur;
    }
    requestAnimationFrame(tick);
  }

  measure();
  build();
  new ResizeObserver(() => { measure(); build(); }).observe(page);
  if (document.fonts) document.fonts.ready.then(build);
  requestAnimationFrame(tick);
})();
