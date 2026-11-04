const WORKER_URL = 'https://tg-proxy.nedoputhub.workers.dev';
const tg = window.Telegram.WebApp;

const state = {
  user: null,
  mode: 'public',
  categories: new Set(),
  countries: new Set(),
  catalogs: { categories: [], countries: [] },
  statsDays: 7
};

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function api(path, method, body) {
  const initData = tg.initData || '';
  let url = WORKER_URL + path;
  const opts = { method: method || 'GET', headers: {} };

  if ((method || 'GET') === 'GET') {
    url += (url.includes('?') ? '&' : '?') + 'init_data=' + encodeURIComponent(initData);
  } else {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(Object.assign({}, body || {}, { init_data: initData }));
  }

  const resp = await fetch(url, opts);
  return resp.json().catch(function () { return { ok: false, error: 'bad_json' }; });
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('init_data', tg.initData || '');
  fd.append('file', file);
  const resp = await fetch(WORKER_URL + '/mini/upload', { method: 'POST', body: fd });
  return resp.json().catch(function () { return { ok: false, error: 'bad_json' }; });
}

async function boot() {
  tg.ready();
  tg.expand();
  try {
    const auth = await api('/mini/auth', 'POST', {});
    if (!auth.ok) throw new Error('auth: ' + (auth.error || '?'));
    state.user = auth.user;
    renderUserBar();

    const menu = await api('/mini/menu');
    if (!menu.ok) throw new Error('menu: ' + (menu.error || '?'));
    state.catalogs.categories = menu.categories || [];
    state.catalogs.countries = menu.countries || [];
    renderCatalogs();

    if (state.user.is_admin) {
      show('tabs');
      bindTabs();
    }

    bindSubmitForm();
    hide('loading');
    show('main');
  } catch (e) {
    showError(e.message);
  }
}

function showError(msg) {
  hide('loading');
  hide('main');
  $('error-msg').textContent = msg;
  show('error');
}

function renderUserBar() {
  const u = state.user;
  const name = u.first_name || u.username || ('id' + u.id);
  $('user-bar').textContent = '👤 ' + name + (u.is_admin ? ' · админ' : '');
}

function renderCatalogs() {
  const catsEl = $('cats');
  catsEl.innerHTML = '';
  state.catalogs.categories.forEach(function (c) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.categories.has(c.key) ? ' active' : '');
    b.textContent = c.emoji + ' ' + c.label;
    b.onclick = function () {
      if (state.categories.has(c.key)) state.categories.delete(c.key);
      else state.categories.add(c.key);
      renderCatalogs();
    };
    catsEl.appendChild(b);
  });

  const cntEl = $('countries');
  cntEl.innerHTML = '';
  state.catalogs.countries.forEach(function (c) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.countries.has(c.key) ? ' active' : '');
    b.textContent = c.emoji + ' ' + c.label;
    b.onclick = function () {
      if (state.countries.has(c.key)) {
        state.countries.delete(c.key);
      } else {
        if (state.countries.size >= 5) {
          tg.showAlert('Можно выбрать не более 5 стран');
          return;
        }
        state.countries.add(c.key);
      }
      renderCatalogs();
    };
    cntEl.appendChild(b);
  });
}

function bindSubmitForm() {
  document.querySelectorAll('.toggle[data-mode]').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.toggle[data-mode]').forEach(function (x) {
        x.classList.remove('active');
      });
      b.classList.add('active');
      state.mode = b.dataset.mode;
    };
  });

  $('files').onchange = function (e) {
    const files = Array.from(e.target.files || []);
    const prev = $('files-preview');
    prev.innerHTML = '';
    if (files.length > 10) {
      prev.innerHTML = '<span class="err">Не более 10 файлов</span>';
      return;
    }
    files.forEach(function (f) {
      const d = document.createElement('div');
      d.className = 'file-item';
      d.textContent = (f.type.indexOf('video') === 0 ? '🎥 ' : '🖼 ') + f.name
        + ' (' + (f.size / 1024 / 1024).toFixed(1) + ' МБ)';
      prev.appendChild(d);
    });
  };

  $('submit-btn').onclick = async function () {
    const btn = $('submit-btn');
    const res = $('submit-result');
    res.className = 'result';
    res.textContent = '';

    const text = $('text').value.trim();
    const files = Array.from($('files').files || []);
    if (!text && files.length === 0) {
      res.className = 'result err';
      res.textContent = '❌ Добавь текст или медиа';
      return;
    }

    btn.disabled = true;
    try {
      const media = [];
      for (let i = 0; i < files.length; i++) {
        res.textContent = 'Загрузка ' + (i + 1) + '/' + files.length + '...';
        const up = await uploadFile(files[i]);
        if (!up.ok) throw new Error('upload: ' + (up.error || '?'));
        media.push({ type: up.media_type, file_id: up.file_id });
      }

      res.textContent = 'Отправка...';
      const custom = $('geo-custom').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      const submit = await api('/mini/submit', 'POST', {
        text: text,
        categories: Array.from(state.categories),
        countries: Array.from(state.countries),
        countries_custom: custom,
        cities: [],
        media: media,
        author_mode: state.mode
      });
      if (!submit.ok) throw new Error(submit.error || '?');

      res.className = 'result ok';
      res.textContent = '✅ Заявка принята. Жди отбивку в чате с ботом.';

      $('text').value = '';
      $('files').value = '';
      $('files-preview').innerHTML = '';
      $('geo-custom').value = '';
      state.categories.clear();
      state.countries.clear();
      renderCatalogs();
    } catch (e) {
      res.className = 'result err';
      res.textContent = '❌ ' + e.message;
    } finally {
      btn.disabled = false;
    }
  };
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (x) { x.classList.add('hidden'); });
      show('tab-' + t.dataset.tab);
      if (t.dataset.tab === 'moderation') loadModeration();
      if (t.dataset.tab === 'stats') loadStats();
    };
  });

  $('mod-refresh').onclick = loadModeration;
}

async function loadModeration() {
  const el = $('mod-list');
  el.innerHTML = '<div class="spinner small"></div>';
  try {
    const data = await api('/mini/admin/moderation/list?page=0');
    if (!data.ok) throw new Error(data.error);
    if (!data.items.length) {
      el.innerHTML = '<p class="empty">📭 Нет заявок</p>';
      return;
    }
    el.innerHTML = '';
    data.items.forEach(function (it) {
      const card = document.createElement('div');
      card.className = 'mod-card';
      card.innerHTML =
        '<div class="mod-head">' +
          '<strong>' + esc(it.author_label) + '</strong>' +
          (it.is_anonymous ? '<span class="badge">🕵️</span>' : '') +
          (it.has_photo ? '<span class="badge">📸</span>' : '') +
        '</div>' +
        '<div class="mod-text">' + esc(it.text_preview || '(без текста)') + '</div>' +
        '<div class="mod-actions">' +
          '<button class="btn-publish">✅ Опубликовать</button>' +
          '<button class="btn-reject">❌ Отклонить</button>' +
          '<button class="btn-remove">🗑 Удалить</button>' +
          '<button class="btn-anon">' + (it.is_anonymous ? '👤 Показать' : '🕵️ Скрыть') + '</button>' +
        '</div>';
      card.querySelector('.btn-publish').onclick = function () { modAction(it.id, 'publish'); };
      card.querySelector('.btn-reject').onclick = function () { modAction(it.id, 'reject'); };
      card.querySelector('.btn-remove').onclick = function () { modAction(it.id, 'remove'); };
      card.querySelector('.btn-anon').onclick = function () {
        modAction(it.id, it.is_anonymous ? 'anon_off' : 'anon_on');
      };
      el.appendChild(card);
    });
  } catch (e) {
    el.innerHTML = '<p class="err">Ошибка: ' + esc(e.message) + '</p>';
  }
}

async function modAction(id, action) {
  if (action === 'reject' || action === 'remove') {
    const ok = await tg.showConfirm(action === 'reject' ? 'Отклонить заявку?' : 'Удалить из очереди?');
    if (!ok) return;
  }
  try {
    const r = await api('/mini/admin/moderation/action', 'POST', { id: id, action: action });
    if (!r.ok) throw new Error(r.error || '?');
    tg.showAlert('Готово');
    loadModeration();
  } catch (e) {
    tg.showAlert('Ошибка: ' + e.message);
  }
}

async function loadStats() {
  const el = $('stats-content');
  el.innerHTML = '<div class="spinner small"></div>';

  document.querySelectorAll('.period-btn').forEach(function (b) {
    b.classList.toggle('active', parseInt(b.dataset.days) === state.statsDays);
    b.onclick = function () {
      state.statsDays = parseInt(b.dataset.days);
      loadStats();
    };
  });

  try {
    const d = await api('/mini/admin/stats?days=' + state.statsDays);
    if (!d.ok) throw new Error(d.error);
    let html = '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-num">' + d.total + '</div>Всего</div>' +
      '<div class="stat-card"><div class="stat-num">' + d.auto + '</div>🤖 Авто</div>' +
      '<div class="stat-card"><div class="stat-num">' + d.manual + '</div>✋ Вручную</div>' +
      '<div class="stat-card"><div class="stat-num">' + d.rejected + '</div>❌ Отклонено</div>' +
      '<div class="stat-card"><div class="stat-num">' + d.scheduled + '</div>⏰ Отложено</div>' +
      '<div class="stat-card"><div class="stat-num">' + (d.feedback || 0) + '</div>💬 FB</div>' +
      '</div>';

    if (d.top_categories && d.top_categories.length) {
      html += '<h3>🏷 Топ рубрик</h3><ul>';
      d.top_categories.forEach(function (x) { html += '<li>' + esc(x.key) + ' — ' + x.count + '</li>'; });
      html += '</ul>';
    }
    if (d.top_authors && d.top_authors.length) {
      html += '<h3>👥 Топ авторов</h3><ul>';
      d.top_authors.forEach(function (x) { html += '<li>@' + esc(x.username) + ' — ' + x.count + '</li>'; });
      html += '</ul>';
    }
    if (d.subscribers != null) {
      html += '<p style="margin-top:16px">👥 Подписчиков: <b>' + d.subscribers + '</b></p>';
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<p class="err">Ошибка: ' + esc(e.message) + '</p>';
  }
}

window.addEventListener('load', boot);
