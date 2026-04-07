(() => {
  'use strict';

  const THEME_KEY = 'steve_theme';

  function isEffectiveDark() {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyThemeFromStorage() {
    const root = document.documentElement;
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else if (t === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    root.classList.toggle('effective-dark', isEffectiveDark());
  }

  function syncThemeToggleLabel(btn) {
    if (!btn) return;
    btn.setAttribute('aria-label', isEffectiveDark() ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function initTheme() {
    applyThemeFromStorage();
    const btn = document.getElementById('themeToggle');
    syncThemeToggleLabel(btn);
    if (btn) {
      btn.addEventListener('click', () => {
        const next = isEffectiveDark() ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        applyThemeFromStorage();
        syncThemeToggleLabel(btn);
      });
    }
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (!localStorage.getItem(THEME_KEY)) applyThemeFromStorage();
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else mq.addListener(onChange);
    } catch { /* empty */ }
  }

  initTheme();

  const STORAGE_KEY = 'steve_tweets_local';
  const HIDDEN_KEY = 'steve_tweets_hidden';
  const ADMIN_KEY = 'steve_admin';
  // ——— Articles ———
  const articleListEn = document.getElementById('articleListEn');
  const articleListZh = document.getElementById('articleListZh');

  function renderArticleList(el, articles) {
    el.innerHTML = articles.map(a => `
      <li>
        <a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>
        <span class="article-date">${formatDate(a.date)}</span>
      </li>
    `).join('');
  }

  async function loadArticles() {
    try {
      const res = await fetch('articles.json?' + Date.now());
      const articles = await res.json();
      renderArticleList(articleListEn, articles.filter(a => a.source === 'substack' || a.source === 'x'));
      renderArticleList(articleListZh, articles.filter(a => a.source === 'wechat'));
    } catch { /* empty */ }
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  loadArticles();

  const timeline = document.getElementById('timeline');
  const adminToggle = document.getElementById('adminToggle');
  const adminPanel = document.getElementById('adminPanel');
  const addBtn = document.getElementById('addBtn');
  const addUrl = document.getElementById('addUrl');
  const addText = document.getElementById('addText');
  const addDate = document.getElementById('addDate');

  let tweets = [];
  let hiddenIds = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));

  async function loadTweets() {
    let baseTweets = [];
    try {
      const res = await fetch('tweets.json?' + Date.now());
      baseTweets = await res.json();
    } catch { /* empty */ }

    const localOnly = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

    const seen = new Set();
    tweets = [];

    for (const t of [...baseTweets, ...localOnly]) {
      const key = t.text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      tweets.push(t);
    }

    tweets.sort((a, b) => b.date.localeCompare(a.date));
    render();
  }

  function saveLocal() {
    const localOnly = tweets.filter(t => t._local);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localOnly));
  }

  function saveHidden() {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenIds]));
  }

  function render() {
    const visible = tweets.filter(t => !hiddenIds.has(t.id));

    let html = '';
    let currentYear = '';
    for (const t of visible) {
      const year = t.date.slice(0, 4);
      if (year !== currentYear) {
        currentYear = year;
        html += `<div class="timeline-year">${year}</div>`;
      }
      html += `
      <div class="timeline-item" data-id="${t.id}">
        <span class="timeline-date">${formatDate(t.date)}</span>
        <div class="timeline-content">
          <p class="timeline-text">${escapeHtml(t.text)}</p>
          ${t.url ? `<a class="timeline-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">→ view on X</a>` : ''}
        </div>
        <button class="timeline-delete" title="Hide this post">&times;</button>
      </div>`;
    }
    timeline.innerHTML = html;

    timeline.querySelectorAll('.timeline-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.closest('.timeline-item').dataset.id;
        hiddenIds.add(id);
        saveHidden();
        render();
      });
    });
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function enableAdmin() {
    adminToggle.classList.add('visible');
    localStorage.setItem(ADMIN_KEY, '1');
  }

  function addTripleClickListener(el) {
    let clickCount = 0;
    let clickTimer = null;
    el.addEventListener('click', (e) => {
      if (e.target === adminToggle || adminToggle.contains(e.target)) return;
      clickCount++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        if (clickCount >= 3) enableAdmin();
        clickCount = 0;
      }, 500);
    });
  }

  const sectionHeader = adminToggle.parentElement;
  addTripleClickListener(sectionHeader);

  adminToggle.addEventListener('click', () => {
    const isOpen = adminPanel.classList.toggle('open');
    timeline.classList.toggle('admin-active', isOpen);
  });

  addBtn.addEventListener('click', () => {
    const url = addUrl.value.trim();
    const text = addText.value.trim();
    const date = addDate.value;

    if (!text) { addText.focus(); return; }
    if (!date) { addDate.focus(); return; }

    if (url && tweets.some(t => t.url === url)) {
      alert('This tweet URL has already been added.');
      return;
    }
    if (tweets.some(t => t.text.slice(0, 80) === text.slice(0, 80))) {
      alert('A tweet with similar content already exists.');
      return;
    }

    tweets.push({ id: generateId(), date, text, url: url || '', _local: true });
    tweets.sort((a, b) => b.date.localeCompare(a.date));
    saveLocal();
    render();

    addUrl.value = '';
    addText.value = '';
    addDate.value = new Date().toISOString().split('T')[0];
  });

  if (localStorage.getItem(ADMIN_KEY) === '1') {
    adminToggle.classList.add('visible');
  }

  addDate.value = new Date().toISOString().split('T')[0];

  // Clear stale localStorage from previous version
  localStorage.removeItem('steve_tweets');

  loadTweets();
})();
