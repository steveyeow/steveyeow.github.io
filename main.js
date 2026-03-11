(() => {
  'use strict';

  const STORAGE_KEY = 'steve_tweets_local';
  const HIDDEN_KEY = 'steve_tweets_hidden';
  const ADMIN_KEY = 'steve_admin';
  const BIO_KEY = 'steve_bio';

  // ——— Bio ———
  const bioEl = document.getElementById('bio');
  const bioEditBar = document.getElementById('bioEditBar');
  const bioEditBtn = document.getElementById('bioEditBtn');
  let bioEditing = false;

  async function loadBio() {
    const saved = localStorage.getItem(BIO_KEY);
    if (saved) {
      bioEl.textContent = saved;
      return;
    }
    try {
      const res = await fetch('bio.json?' + Date.now());
      const data = await res.json();
      bioEl.textContent = data.lines.join('\n');
    } catch {
      bioEl.textContent = 'Building AGI for the rest of us';
    }
  }

  function enterBioEdit() {
    bioEditing = true;
    bioEl.contentEditable = 'true';
    bioEl.focus();
    bioEditBtn.textContent = 'Save';
    bioEditBtn.classList.add('bio-edit-btn--save');
  }

  function saveBioEdit() {
    bioEditing = false;
    bioEl.contentEditable = 'false';
    const text = bioEl.innerText.trim();
    localStorage.setItem(BIO_KEY, text);
    bioEl.textContent = text;
    bioEditBtn.textContent = 'Edit';
    bioEditBtn.classList.remove('bio-edit-btn--save');
  }

  bioEditBtn.addEventListener('click', () => {
    if (bioEditing) saveBioEdit();
    else enterBioEdit();
  });

  // Show edit bar when admin mode is active
  function syncBioEditBar() {
    if (localStorage.getItem(ADMIN_KEY) === '1') {
      bioEditBar.classList.add('visible');
    }
  }

  loadBio();
  syncBioEditBar();

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

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function render() {
    const visible = tweets.filter(t => !hiddenIds.has(t.id));

    timeline.innerHTML = visible.map(t => `
      <div class="timeline-item" data-id="${t.id}">
        <span class="timeline-date">${formatDate(t.date)}</span>
        <div class="timeline-content">
          <p class="timeline-text">${escapeHtml(t.text)}</p>
          ${t.url ? `<a class="timeline-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">→ view on X</a>` : ''}
        </div>
        <button class="timeline-delete" title="Hide this post">&times;</button>
      </div>
    `).join('');

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

  // Admin mode: triple-click the section title to reveal
  const sectionHeader = adminToggle.parentElement;
  let clickCount = 0;
  let clickTimer = null;
  sectionHeader.addEventListener('click', (e) => {
    if (e.target === adminToggle || adminToggle.contains(e.target)) return;
    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (clickCount >= 3) {
        adminToggle.classList.add('visible');
        bioEditBar.classList.add('visible');
        localStorage.setItem(ADMIN_KEY, '1');
      }
      clickCount = 0;
    }, 400);
  });

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
