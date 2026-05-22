/* ── Content Calendar Module ─────────────────────────────────────────────── */

const PLATFORM_ICONS = {
  facebook: '🔵',
  instagram: '📷',
  youtube: '▶️',
  tiktok: '♪',
  threads: '◎',
  pinterest: '📌',
};

const PLATFORM_COLORS = {
  facebook: '#1877F2',
  instagram: '#E1306C',
  youtube: '#FF0000',
  tiktok: '#ffffff',
  threads: '#f0f0f5',
  pinterest: '#E60023',
};

const PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok', 'threads', 'pinterest'];
const FORMATS = ['Reel', 'Video largo', 'Short', 'Carrusel', 'Post texto', 'Story', 'Thread', 'Pin'];
const CONTENT_PILLARS = ['🌍 Escenario', '🔄 Proceso', '💥 Tensión', '💑 Vida construida'];
const CONTENT_TYPES = ['Reel', 'Carrusel', 'Story', 'Post estático', 'Video largo', 'Short', 'Thread', 'Pin'];
const STATUSES = ['draft', 'scheduled', 'published'];
const STATUS_LABELS = { draft: 'Borrador', scheduled: 'Programado', published: 'Publicado' };

const MONTH_NAMES_ES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
];

const DAY_NAMES_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

let calState = {
  view: 'month',
  currentDate: new Date(),
  filters: { platforms: [], status: 'all' },
  posts: [],
  ideas: [],
  editingPost: null,
  editingIdea: null,
  listPage: 1,
  listSearch: '',
  listStatus: 'all',
};

let calInitialized = false;

/* ── Init ──────────────────────────────────────────────────────────────── */
function initCalendario() {
  if (calInitialized) return;
  calInitialized = true;
  renderCalToolbar();
  calSwitchView('month', document.querySelector('.cal-view-btn[data-view="month"]'));
}

/* ── Toolbar ────────────────────────────────────────────────────────────── */
function renderCalToolbar() {
  updateMonthLabel();
  renderPlatformFilters();
}

function updateMonthLabel() {
  const el = document.getElementById('cal-month-label');
  if (!el) return;
  const d = calState.currentDate;
  el.textContent = `${MONTH_NAMES_ES[d.getMonth()]} ${d.getFullYear()}`;
}

function renderPlatformFilters() {
  const el = document.getElementById('cal-platform-filters');
  if (!el) return;
  const statusOptions = ['all', 'draft', 'scheduled', 'published'];
  el.innerHTML = `
    <select class="cal-status-filter" onchange="calSetStatusFilter(this.value)">
      ${statusOptions.map(s => `<option value="${s}" ${calState.filters.status === s ? 'selected' : ''}>${s === 'all' ? 'Todos los estados' : STATUS_LABELS[s]}</option>`).join('')}
    </select>
    ${PLATFORMS.map(p => `
      <button class="cal-filter-pill ${calState.filters.platforms.includes(p) ? 'active' : ''}"
        onclick="calTogglePlatformFilter('${p}', this)">
        ${PLATFORM_ICONS[p]} ${p.charAt(0).toUpperCase() + p.slice(1)}
      </button>
    `).join('')}
  `;
}

function calTogglePlatformFilter(platform, btn) {
  const idx = calState.filters.platforms.indexOf(platform);
  if (idx === -1) calState.filters.platforms.push(platform);
  else calState.filters.platforms.splice(idx, 1);
  btn.classList.toggle('active');
  calRefresh();
}

function calSetStatusFilter(status) {
  calState.filters.status = status;
  calRefresh();
}

function calRefresh() {
  if (calState.view === 'month') renderMonthView();
  else if (calState.view === 'list') renderListView();
  else if (calState.view === 'ideas') renderIdeasView();
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
function calSwitchView(view, btn) {
  calState.view = view;
  document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const nav = document.getElementById('cal-nav');
  if (nav) nav.style.display = (view === 'month') ? 'flex' : 'none';
  updateMonthLabel();
  calRefresh();
}

function calPrevMonth() {
  const d = calState.currentDate;
  calState.currentDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  updateMonthLabel();
  renderMonthView();
}

function calNextMonth() {
  const d = calState.currentDate;
  calState.currentDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  updateMonthLabel();
  renderMonthView();
}

function calGoToday() {
  calState.currentDate = new Date();
  updateMonthLabel();
  renderMonthView();
}

/* ── Month View ─────────────────────────────────────────────────────────── */
async function renderMonthView() {
  const el = document.getElementById('cal-content');
  if (!el) return;

  const d = calState.currentDate;
  const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">⏳</div><div class="cal-empty-text">Cargando...</div></div>';

  try {
    const res = await fetch(`/api/posts?month=${yearMonth}`);
    const json = await res.json();
    calState.posts = json.success ? (json.data || []) : [];
  } catch (_) { calState.posts = []; }

  const filteredPosts = filterPosts(calState.posts);
  renderMonthGrid(el, filteredPosts);
  updateStatsBar(filteredPosts);
  setupDragDrop();
}

function filterPosts(posts) {
  return posts.filter(p => {
    if (calState.filters.status !== 'all' && p.status !== calState.filters.status) return false;
    if (calState.filters.platforms.length > 0) {
      const platformMatch = calState.filters.platforms.some(pl => (p.platforms || []).includes(pl));
      if (!platformMatch) return false;
    }
    return true;
  });
}

function renderMonthGrid(el, posts) {
  const d = calState.currentDate;
  const year = d.getFullYear();
  const month = d.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay(); // 0=Sun
  const today = new Date();

  // Group posts by date string
  const postsByDate = {};
  posts.forEach(p => {
    if (p.scheduledDate) {
      const dateStr = p.scheduledDate.split('T')[0];
      if (!postsByDate[dateStr]) postsByDate[dateStr] = [];
      postsByDate[dateStr].push(p);
    }
  });
  // Drafts without a date
  const drafts = posts.filter(p => !p.scheduledDate && p.status === 'draft');

  let html = '<div class="cal-month-grid-wrapper"><div class="cal-month-grid">';

  // Weekday headers
  DAY_NAMES_ES.forEach(d => {
    html += `<div class="cal-weekday-header">${d}</div>`;
  });

  // Pad before first
  for (let i = 0; i < startPad; i++) {
    const prevMonthDay = new Date(year, month, -startPad + i + 1);
    html += renderDayCell(prevMonthDay, [], true);
  }

  // Days of month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayPosts = postsByDate[dateStr] || [];
    const isToday = date.toDateString() === today.toDateString();
    html += renderDayCell(date, dayPosts, false, isToday);
  }

  // Pad after last
  const totalCells = startPad + lastDay.getDate();
  const endPad = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= endPad; i++) {
    const nextMonthDay = new Date(year, month + 1, i);
    html += renderDayCell(nextMonthDay, [], true);
  }

  html += '</div></div>';

  // Drafts without date section
  if (drafts.length > 0) {
    html += `<div style="margin-top:20px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:10px;">
        📝 Borradores sin fecha (${drafts.length})
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${drafts.map(p => `
          <div class="cal-chip status-draft" style="cursor:pointer;padding:6px 10px;" onclick="openPostModal(${JSON.stringify(JSON.stringify(p))})">
            ${renderPlatformIcons(p.platforms)} ${escHtml(p.hook || p.title || 'Borrador')}
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  el.innerHTML = html;
}

function renderDayCell(date, posts, otherMonth = false, isToday = false) {
  const dateStr = date.toISOString().split('T')[0];
  const classes = ['cal-day-cell', otherMonth ? 'other-month' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
  const chips = posts.map(p => renderChip(p)).join('');

  return `<div class="${classes}"
    data-date="${dateStr}"
    ondragover="calDragOver(event)"
    ondrop="calDrop(event, '${dateStr}')"
    ondragleave="this.classList.remove('drag-over')"
    onclick="calDayCellClick(event, '${dateStr}')">
    <div class="cal-day-num">${date.getDate()}</div>
    ${chips}
    <button class="cal-day-add" onclick="event.stopPropagation();openPostModal(null,'${dateStr}')">+</button>
  </div>`;
}

function renderChip(post) {
  const statusClass = `status-${post.status || 'draft'}`;
  const icons = renderPlatformIcons(post.platforms);
  const label = escHtml((post.hook || post.title || 'Post').substring(0, 40));
  const postJson = escAttr(JSON.stringify(post));

  return `<div class="cal-chip ${statusClass}"
    draggable="true"
    data-post-id="${post.id}"
    ondragstart="calDragStart(event, '${post.id}')"
    onclick="event.stopPropagation();openPostModal('${postJson}')"
    title="${escAttr(post.hook || post.title || '')}">
    <span class="chip-icon">${icons}</span>
    <span class="chip-text">${label}</span>
    <div class="chip-actions" onclick="event.stopPropagation()">
      <button class="chip-action-btn" title="Editar" onclick="openPostModal('${postJson}')">✏️</button>
      <button class="chip-action-btn" title="Duplicar" onclick="duplicatePost('${post.id}')">📋</button>
      <button class="chip-action-btn" title="Publicado" onclick="changePostStatus('${post.id}','published')">✅</button>
      <button class="chip-action-btn" title="Eliminar" onclick="deletePost('${post.id}')">🗑</button>
    </div>
  </div>`;
}

function renderPlatformIcons(platforms) {
  if (!platforms || platforms.length === 0) return '';
  return platforms.map(p => PLATFORM_ICONS[p] || '').join('');
}

function calDayCellClick(event, dateStr) {
  if (event.target.closest('.cal-chip') || event.target.closest('.cal-day-add')) return;
  openPostModal(null, dateStr);
}

/* ── Stats Bar ──────────────────────────────────────────────────────────── */
function updateStatsBar(posts) {
  const el = document.getElementById('cal-stats-bar');
  if (!el) return;

  const counts = { draft: 0, scheduled: 0, published: 0 };
  const platformCounts = {};

  posts.forEach(p => {
    counts[p.status] = (counts[p.status] || 0) + 1;
    (p.platforms || []).forEach(pl => {
      platformCounts[pl] = (platformCounts[pl] || 0) + 1;
    });
  });

  const statusPills = Object.entries(counts)
    .map(([s, c]) => `<div class="cal-stat-pill"><span>${STATUS_LABELS[s]}</span><span class="stat-count">${c}</span></div>`)
    .join('');

  const platformPills = Object.entries(platformCounts)
    .map(([p, c]) => `<div class="cal-stat-pill"><span>${PLATFORM_ICONS[p]} ${p}</span><span class="stat-count">${c}</span></div>`)
    .join('');

  el.innerHTML = statusPills + platformPills;
}

/* ── Drag & Drop ────────────────────────────────────────────────────────── */
let draggedPostId = null;

function calDragStart(event, postId) {
  draggedPostId = postId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', postId);
}

function calDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const cell = event.currentTarget;
  if (cell.classList.contains('cal-day-cell') && !cell.classList.contains('drag-over')) {
    document.querySelectorAll('.cal-day-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
    cell.classList.add('drag-over');
  }
}

async function calDrop(event, dateStr) {
  event.preventDefault();
  const cell = event.currentTarget;
  cell.classList.remove('drag-over');
  const postId = draggedPostId || event.dataTransfer.getData('text/plain');
  if (!postId) return;
  draggedPostId = null;

  try {
    const res = await fetch(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledDate: dateStr + 'T12:00:00.000Z', status: 'scheduled' }),
    });
    const json = await res.json();
    if (json.success) renderMonthView();
  } catch (_) {}
}

/* ── Post Modal ─────────────────────────────────────────────────────────── */
function openPostModal(postJsonStr, date) {
  let post = null;
  if (postJsonStr) {
    try {
      post = typeof postJsonStr === 'string' ? JSON.parse(postJsonStr) : postJsonStr;
    } catch (_) { post = null; }
  }
  calState.editingPost = post;

  document.getElementById('cal-modal-title').textContent = post ? 'Editar post' : 'Nuevo post';
  renderModalForm(post, date);
  updatePreview();

  const overlay = document.getElementById('cal-modal-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closePostModal() {
  const overlay = document.getElementById('cal-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  calState.editingPost = null;
}

function renderModalForm(post, defaultDate) {
  const el = document.getElementById('cal-modal-form');
  if (!el) return;

  const p = post || {};
  const platforms = p.platforms || [];
  const tags = p.tags || [];
  const scheduledDate = p.scheduledDate ? p.scheduledDate.split('T')[0] : (defaultDate || '');

  el.innerHTML = `
    <div class="cal-form-group">
      <label class="cal-form-label">Título (interno)</label>
      <input class="cal-form-input" id="pf-title" placeholder="Título de referencia..." value="${escAttr(p.title || '')}"/>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Hook ✨</label>
      <textarea class="cal-form-textarea" id="pf-hook" rows="3" placeholder="La primera línea que engancha..." oninput="updatePreview()">${escHtml(p.hook || '')}</textarea>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Cuerpo</label>
      <textarea class="cal-form-textarea" id="pf-body" rows="5" placeholder="Desarrollo del contenido..." oninput="updatePreview()">${escHtml(p.body || '')}</textarea>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">CTA</label>
      <textarea class="cal-form-textarea" id="pf-cta" rows="2" placeholder="Llamada a la acción..." oninput="updatePreview()">${escHtml(p.cta || '')}</textarea>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Plataformas</label>
      <div class="platform-toggles">
        ${PLATFORMS.map(pl => `
          <button type="button" class="platform-toggle ${platforms.includes(pl) ? 'active' : ''}"
            data-platform="${pl}"
            onclick="calTogglePlatform(this, '${pl}')">
            ${PLATFORM_ICONS[pl]} ${pl.charAt(0).toUpperCase() + pl.slice(1)}
          </button>
        `).join('')}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="cal-form-group">
        <label class="cal-form-label">Formato</label>
        <select class="cal-form-select" id="pf-format">
          <option value="">Seleccionar...</option>
          ${FORMATS.map(f => `<option value="${f}" ${(p.format || p.contentType) === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>

      <div class="cal-form-group">
        <label class="cal-form-label">Estado</label>
        <select class="cal-form-select" id="pf-status">
          ${STATUSES.map(s => `<option value="${s}" ${(p.status || 'draft') === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Pilar de contenido</label>
      <select class="cal-form-select" id="pf-pillar">
        <option value="">Sin pilar</option>
        ${CONTENT_PILLARS.map(cp => `<option value="${cp}" ${p.pillar === cp ? 'selected' : ''}>${cp}</option>`).join('')}
      </select>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="cal-form-group">
        <label class="cal-form-label">Fecha programada</label>
        <input class="cal-form-input" type="date" id="pf-date" value="${escAttr(scheduledDate)}"/>
      </div>
      <div class="cal-form-group">
        <label class="cal-form-label">Hora</label>
        <input class="cal-form-input" type="time" id="pf-time" value="${escAttr(p.scheduledTime || '')}"/>
      </div>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Tema / Ángulo</label>
      <input class="cal-form-input" id="pf-theme" placeholder="El tema o ángulo específico..." value="${escAttr(p.theme || '')}"/>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Tags</label>
      <div class="tags-input-row" id="tags-row" onclick="document.getElementById('pf-tags-input').focus()">
        ${tags.map(t => `<span class="tag-chip">${escHtml(t)}<button class="tag-chip-remove" onclick="calRemoveTag('${escAttr(t)}')">×</button></span>`).join('')}
        <input class="tags-input" id="pf-tags-input" placeholder="Agregar tag..." onkeydown="calHandleTagKey(event)"/>
      </div>
    </div>

    <div class="cal-form-group">
      <label class="cal-form-label">Notas</label>
      <textarea class="cal-form-textarea" id="pf-notes" rows="2" placeholder="Notas internas...">${escHtml(p.notes || '')}</textarea>
    </div>
  `;

  // Render footer
  const footer = document.getElementById('cal-modal-footer');
  if (footer) {
    footer.innerHTML = `
      ${post ? `<button class="btn-danger" onclick="deletePost('${post.id}')">🗑 Eliminar</button>` : ''}
      ${post ? `<button class="btn-secondary" onclick="duplicatePost('${post.id}')">📋 Duplicar</button>` : ''}
      <span style="flex:1;"></span>
      <button class="btn-secondary" onclick="closePostModal()">Cancelar</button>
      <button class="btn-primary" onclick="savePost()">💾 Guardar</button>
    `;
  }

  // Store current tags
  window._calCurrentTags = [...tags];
}

function calTogglePlatform(btn, platform) {
  btn.classList.toggle('active');
}

function calHandleTagKey(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    const val = event.target.value.trim().replace(/,/g, '');
    if (val && !window._calCurrentTags.includes(val)) {
      window._calCurrentTags.push(val);
      event.target.value = '';
      refreshTagsDisplay();
    }
  }
}

function calRemoveTag(tag) {
  window._calCurrentTags = (window._calCurrentTags || []).filter(t => t !== tag);
  refreshTagsDisplay();
}

function refreshTagsDisplay() {
  const tags = window._calCurrentTags || [];
  const input = document.getElementById('pf-tags-input');
  const row = document.getElementById('tags-row');
  if (!row || !input) return;
  const inputClone = input.cloneNode(true);
  inputClone.onkeydown = calHandleTagKey;
  row.innerHTML = tags.map(t => `<span class="tag-chip">${escHtml(t)}<button class="tag-chip-remove" onclick="calRemoveTag('${escAttr(t)}')">×</button></span>`).join('');
  row.appendChild(inputClone);
  inputClone.focus();
}

function updatePreview() {
  const hook = document.getElementById('pf-hook');
  const body = document.getElementById('pf-body');
  const cta = document.getElementById('pf-cta');
  if (!hook) return;
  document.getElementById('prev-hook').textContent = hook.value || '';
  document.getElementById('prev-body').textContent = body ? body.value : '';
  document.getElementById('prev-cta').textContent = cta ? cta.value : '';
}

async function savePost() {
  const platforms = [];
  document.querySelectorAll('.platform-toggle.active').forEach(btn => {
    platforms.push(btn.dataset.platform);
  });

  const dateVal = document.getElementById('pf-date') ? document.getElementById('pf-date').value : '';
  const timeVal = document.getElementById('pf-time') ? document.getElementById('pf-time').value : '';
  const scheduledDate = dateVal ? (dateVal + 'T' + (timeVal || '12:00') + ':00.000Z') : null;

  const data = {
    title: document.getElementById('pf-title') ? document.getElementById('pf-title').value.trim() : '',
    hook: document.getElementById('pf-hook') ? document.getElementById('pf-hook').value.trim() : '',
    body: document.getElementById('pf-body') ? document.getElementById('pf-body').value.trim() : '',
    cta: document.getElementById('pf-cta') ? document.getElementById('pf-cta').value.trim() : '',
    format: document.getElementById('pf-format') ? document.getElementById('pf-format').value : '',
    contentType: document.getElementById('pf-format') ? document.getElementById('pf-format').value : '',
    pillar: document.getElementById('pf-pillar') ? document.getElementById('pf-pillar').value : '',
    theme: document.getElementById('pf-theme') ? document.getElementById('pf-theme').value.trim() : '',
    scheduledTime: timeVal,
    status: document.getElementById('pf-status') ? document.getElementById('pf-status').value : 'draft',
    notes: document.getElementById('pf-notes') ? document.getElementById('pf-notes').value.trim() : '',
    platforms,
    scheduledDate,
    tags: window._calCurrentTags || [],
  };

  try {
    const post = calState.editingPost;
    const url = post ? `/api/posts/${post.id}` : '/api/posts';
    const method = post ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.success) {
      closePostModal();
      calRefresh();
    } else {
      alert('Error al guardar: ' + (json.error || 'Error desconocido'));
    }
  } catch (err) {
    alert('Error de red al guardar');
  }
}

async function deletePost(id) {
  if (!confirm('¿Eliminar este post?')) return;
  try {
    const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      closePostModal();
      calRefresh();
    }
  } catch (_) {}
}

async function duplicatePost(id) {
  try {
    const res = await fetch(`/api/posts/${id}/duplicate`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      closePostModal();
      calRefresh();
    }
  } catch (_) {}
}

async function changePostStatus(id, status) {
  try {
    const res = await fetch(`/api/posts/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (json.success) calRefresh();
  } catch (_) {}
}

/* ── List View ──────────────────────────────────────────────────────────── */
async function renderListView() {
  const el = document.getElementById('cal-content');
  if (!el) return;

  el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">⏳</div><div class="cal-empty-text">Cargando...</div></div>';

  try {
    const res = await fetch('/api/posts');
    const json = await res.json();
    calState.posts = json.success ? (json.data || []) : [];
  } catch (_) { calState.posts = []; }

  let posts = filterPosts(calState.posts);

  if (calState.listSearch) {
    const q = calState.listSearch.toLowerCase();
    posts = posts.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.hook || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  const PAGE_SIZE = 20;
  const total = posts.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  calState.listPage = Math.min(calState.listPage, totalPages);
  const start = (calState.listPage - 1) * PAGE_SIZE;
  const page = posts.slice(start, start + PAGE_SIZE);

  let html = `
    <div class="cal-list-controls">
      <input class="cal-list-search" placeholder="Buscar posts..." value="${escAttr(calState.listSearch)}"
        oninput="calListSearch(this.value)"/>
    </div>
  `;

  if (page.length === 0) {
    html += '<div class="cal-empty"><div class="cal-empty-icon">📭</div><div class="cal-empty-text">No hay posts</div><div class="cal-empty-sub">Crea tu primer post con el botón de arriba.</div></div>';
  } else {
    html += `
      <table class="cal-list-table">
        <thead>
          <tr>
            <th>Hook / Título</th>
            <th>Plataformas</th>
            <th>Tipo</th>
            <th>Fecha</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${page.map(p => {
            const dateStr = p.scheduledDate ? p.scheduledDate.split('T')[0] : '—';
            const postAttr = escAttr(JSON.stringify(p));
            return `<tr>
              <td>
                <div style="font-weight:600;color:var(--text-primary);">${escHtml((p.hook || p.title || '—').substring(0, 60))}</div>
                ${p.tags && p.tags.length > 0 ? `<div style="margin-top:4px;">${p.tags.map(t => `<span class="tag-chip" style="font-size:10px;">${escHtml(t)}</span>`).join('')}</div>` : ''}
              </td>
              <td><span class="list-platform-icons">${renderPlatformIcons(p.platforms)}</span></td>
              <td style="color:var(--text-secondary);font-size:12px;">${escHtml(p.contentType || '—')}</td>
              <td style="color:var(--text-secondary);font-size:12px;">${dateStr}</td>
              <td><span class="list-status-badge status-${p.status}">${STATUS_LABELS[p.status] || p.status}</span></td>
              <td>
                <div class="list-actions">
                  <button class="list-action-btn" onclick="openPostModal('${postAttr}')">✏️</button>
                  <button class="list-action-btn" onclick="duplicatePost('${p.id}')">📋</button>
                  <button class="list-action-btn danger" onclick="deletePost('${p.id}')">🗑</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${totalPages > 1 ? renderPagination(calState.listPage, totalPages, total) : ''}
    `;
  }

  el.innerHTML = html;
  updateStatsBar(calState.posts);
}

function renderPagination(current, total, itemCount) {
  let html = `<div class="cal-list-pagination"><span style="color:var(--text-muted);font-size:12px;">${itemCount} posts</span>`;
  for (let i = 1; i <= total; i++) {
    html += `<button class="cal-page-btn ${i === current ? 'active' : ''}" onclick="calSetPage(${i})">${i}</button>`;
  }
  html += '</div>';
  return html;
}

function calListSearch(val) {
  calState.listSearch = val;
  calState.listPage = 1;
  renderListView();
}

function calSetPage(p) {
  calState.listPage = p;
  renderListView();
}

/* ── Ideas View ─────────────────────────────────────────────────────────── */
async function renderIdeasView() {
  const el = document.getElementById('cal-content');
  if (!el) return;

  el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">⏳</div><div class="cal-empty-text">Cargando...</div></div>';

  try {
    const res = await fetch('/api/ideas');
    const json = await res.json();
    calState.ideas = json.success ? (json.data || []) : [];
  } catch (_) { calState.ideas = []; }

  let html = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <button class="btn-primary" onclick="openIdeaModal()">+ Nueva idea</button>
    </div>
    <div class="ideas-grid">
      <div class="idea-card-new" onclick="openIdeaModal()">
        <div style="font-size:32px;margin-bottom:8px;">💡</div>
        <div>Nueva idea</div>
      </div>
      ${calState.ideas.map(idea => {
        const ideaAttr = escAttr(JSON.stringify(idea));
        return `<div class="ideas-card">
          <div class="ideas-card-title">${escHtml(idea.title || '—')}</div>
          ${idea.hook ? `<div class="ideas-card-hook">"${escHtml(idea.hook)}"</div>` : ''}
          ${idea.notes ? `<div class="ideas-card-notes">${escHtml(idea.notes)}</div>` : ''}
          ${idea.tags && idea.tags.length > 0 ? `<div class="ideas-card-tags">${idea.tags.map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join('')}</div>` : ''}
          <div class="ideas-card-actions">
            <button class="list-action-btn" onclick="openIdeaModal('${ideaAttr}')">✏️ Editar</button>
            <button class="list-action-btn" onclick="convertIdea('${idea.id}')">🚀 → Post</button>
            <button class="list-action-btn danger" onclick="deleteIdea('${idea.id}')">🗑</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">${new Date(idea.createdAt).toLocaleDateString('es-ES')}</div>
        </div>`;
      }).join('')}
    </div>
  `;

  el.innerHTML = html;
  const statsBar = document.getElementById('cal-stats-bar');
  if (statsBar) statsBar.innerHTML = `<div class="cal-stat-pill"><span>💡 Ideas</span><span class="stat-count">${calState.ideas.length}</span></div>`;
}

/* ── Idea Modal ─────────────────────────────────────────────────────────── */
function openIdeaModal(ideaJsonStr) {
  let idea = null;
  if (ideaJsonStr) {
    try {
      idea = typeof ideaJsonStr === 'string' ? JSON.parse(ideaJsonStr) : ideaJsonStr;
    } catch (_) { idea = null; }
  }
  calState.editingIdea = idea;

  document.getElementById('idea-modal-title').textContent = idea ? 'Editar idea' : 'Nueva idea';
  renderIdeaForm(idea);

  const overlay = document.getElementById('idea-modal-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeIdeaModal() {
  const overlay = document.getElementById('idea-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  calState.editingIdea = null;
}

function renderIdeaForm(idea) {
  const el = document.getElementById('idea-modal-form');
  if (!el) return;

  const i = idea || {};
  const tags = i.tags || [];
  window._calCurrentIdeaTags = [...tags];

  el.innerHTML = `
    <div class="cal-form-group" style="margin-bottom:12px;">
      <label class="cal-form-label">Título</label>
      <input class="cal-form-input" id="if-title" placeholder="Título o tema de la idea..." value="${escAttr(i.title || '')}"/>
    </div>
    <div class="cal-form-group" style="margin-bottom:12px;">
      <label class="cal-form-label">Hook inicial</label>
      <textarea class="cal-form-textarea" id="if-hook" rows="2" placeholder="Primera idea de hook...">${escHtml(i.hook || '')}</textarea>
    </div>
    <div class="cal-form-group" style="margin-bottom:12px;">
      <label class="cal-form-label">Notas</label>
      <textarea class="cal-form-textarea" id="if-notes" rows="3" placeholder="Notas, referencias, ideas...">${escHtml(i.notes || '')}</textarea>
    </div>
    <div class="cal-form-group" style="margin-bottom:12px;">
      <label class="cal-form-label">Tags</label>
      <div class="tags-input-row" id="idea-tags-row">
        ${tags.map(t => `<span class="tag-chip">${escHtml(t)}<button class="tag-chip-remove" onclick="calRemoveIdeaTag('${escAttr(t)}')">×</button></span>`).join('')}
        <input class="tags-input" id="if-tags-input" placeholder="Agregar tag..." onkeydown="calHandleIdeaTagKey(event)"/>
      </div>
    </div>
  `;

  const footer = document.getElementById('idea-modal-footer');
  if (footer) {
    footer.innerHTML = `
      ${idea ? `<button class="btn-danger" onclick="deleteIdea('${idea.id}');closeIdeaModal();">🗑 Eliminar</button>` : ''}
      <span style="flex:1;"></span>
      <button class="btn-secondary" onclick="closeIdeaModal()">Cancelar</button>
      <button class="btn-primary" onclick="saveIdea()">💾 Guardar</button>
    `;
  }
}

function calHandleIdeaTagKey(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    const val = event.target.value.trim().replace(/,/g, '');
    if (val && !window._calCurrentIdeaTags.includes(val)) {
      window._calCurrentIdeaTags.push(val);
      event.target.value = '';
      refreshIdeaTagsDisplay();
    }
  }
}

function calRemoveIdeaTag(tag) {
  window._calCurrentIdeaTags = (window._calCurrentIdeaTags || []).filter(t => t !== tag);
  refreshIdeaTagsDisplay();
}

function refreshIdeaTagsDisplay() {
  const tags = window._calCurrentIdeaTags || [];
  const input = document.getElementById('if-tags-input');
  const row = document.getElementById('idea-tags-row');
  if (!row || !input) return;
  const inputClone = input.cloneNode(true);
  inputClone.onkeydown = calHandleIdeaTagKey;
  row.innerHTML = tags.map(t => `<span class="tag-chip">${escHtml(t)}<button class="tag-chip-remove" onclick="calRemoveIdeaTag('${escAttr(t)}')">×</button></span>`).join('');
  row.appendChild(inputClone);
  inputClone.focus();
}

async function saveIdea() {
  const data = {
    title: document.getElementById('if-title') ? document.getElementById('if-title').value.trim() : '',
    hook: document.getElementById('if-hook') ? document.getElementById('if-hook').value.trim() : '',
    notes: document.getElementById('if-notes') ? document.getElementById('if-notes').value.trim() : '',
    tags: window._calCurrentIdeaTags || [],
  };

  if (!data.title) { alert('El título es requerido'); return; }

  try {
    const idea = calState.editingIdea;
    const url = idea ? `/api/ideas/${idea.id}` : '/api/ideas';
    const method = idea ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.success) {
      closeIdeaModal();
      renderIdeasView();
    } else {
      alert('Error: ' + (json.error || 'Error desconocido'));
    }
  } catch (_) {
    alert('Error de red');
  }
}

async function deleteIdea(id) {
  if (!confirm('¿Eliminar esta idea?')) return;
  try {
    await fetch(`/api/ideas/${id}`, { method: 'DELETE' });
    renderIdeasView();
  } catch (_) {}
}

async function convertIdea(id) {
  if (!confirm('¿Convertir esta idea en un post borrador?')) return;
  try {
    const res = await fetch(`/api/ideas/${id}/convert`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      renderIdeasView();
      alert('¡Idea convertida en post borrador!');
    }
  } catch (_) {}
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setupDragDrop() {
  // Already set up via inline handlers in renderChip/renderDayCell
}
