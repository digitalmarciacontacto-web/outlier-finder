require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { loadOutliersFromRedis } = require('./redis');

const brandBlueprint = fs.readFileSync('./brand-blueprint.md', 'utf8');

const app = express();
app.use(express.json({ limit: '2mb' }));

const OUTLIERS_FILE = path.join(__dirname, 'outliers.json');

async function readOutliers() {
  // 1. Try Redis first
  try {
    const data = await loadOutliersFromRedis();
    if (data) return data;
  } catch {}

  // 2. Fallback to local file
  if (!fs.existsSync(OUTLIERS_FILE)) return { date: null, videos: [] };
  try {
    return JSON.parse(fs.readFileSync(OUTLIERS_FILE, 'utf-8'));
  } catch {
    return { date: null, videos: [] };
  }
}

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  const { date, videos } = await readOutliers();

  const cards = videos.length === 0
    ? `<div class="empty">
        <p>No hay datos aún.</p>
        <p>Ejecuta <code>npm run run-now</code> para generar el primer análisis.</p>
       </div>`
    : videos.map((v, i) => `
      <div class="card" data-index="${i}">
        <div class="card-top">
          <div class="score-badge">${v.score}<span>x</span></div>
          <div class="card-meta">
            <div class="card-channel">${v.channel}</div>
            <div class="card-views">👁 ${(v.views / 1000).toFixed(1)}K vistas · promedio ${(v.channelAvg / 1000).toFixed(1)}K</div>
          </div>
        </div>
        <a class="card-title" href="${v.url}" target="_blank">${v.title}</a>
        <div class="card-actions">
          <a class="btn-yt" href="${v.url}" target="_blank">▶ Ver video</a>
          <button class="btn-gen" onclick="generateScript(${i})">✨ Generar guion</button>
        </div>
        <div class="script-box" id="script-${i}" style="display:none;">
          <div class="script-loading" id="loading-${i}" style="display:none;">
            <div class="spinner"></div><span>Generando guion con Claude...</span>
          </div>
          <div class="script-content" id="content-${i}"></div>
          <div class="script-actions" id="script-actions-${i}" style="display:none;">
            <button class="btn-copy" onclick="copyScript(${i})">📋 Copiar guion</button>
            <button class="btn-teleprompter" onclick="openTeleprompter(${i})">📺 Abrir teleprompter</button>
          </div>
        </div>
      </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Digital Marcia — Content Studio</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0a0a0f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
    }

    header {
      background: linear-gradient(135deg, #1a1033 0%, #0f172a 100%);
      border-bottom: 1px solid #1e293b;
      padding: 20px 40px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    header .logo { font-size: 28px; }
    header h1 {
      font-size: 22px;
      font-weight: 800;
      background: linear-gradient(90deg, #a78bfa, #60a5fa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }
    header p { font-size: 13px; color: #64748b; margin-top: 2px; }

    .date-bar {
      background: #111827;
      padding: 10px 40px;
      font-size: 13px;
      color: #4b5563;
      border-bottom: 1px solid #1e293b;
    }
    .date-bar span { color: #818cf8; font-weight: 600; }

    main { padding: 32px 40px; max-width: 900px; margin: 0 auto; }

    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .empty { text-align: center; padding: 80px 20px; color: #4b5563; }
    .empty code {
      background: #1e293b;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 14px;
      color: #94a3b8;
    }

    /* ── Cards ── */
    .card {
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #312e81; }

    .card-top { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }

    .score-badge {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff;
      font-size: 32px;
      font-weight: 900;
      padding: 8px 14px;
      border-radius: 10px;
      line-height: 1;
      min-width: 70px;
      text-align: center;
      flex-shrink: 0;
    }
    .score-badge span { font-size: 16px; opacity: 0.8; }

    .card-channel {
      font-size: 13px;
      color: #818cf8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .card-views { font-size: 13px; color: #4b5563; }

    .card-title {
      display: block;
      font-size: 16px;
      font-weight: 600;
      color: #e2e8f0;
      text-decoration: none;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .card-title:hover { color: #a78bfa; }

    .card-actions { display: flex; gap: 10px; flex-wrap: wrap; }

    /* ── Buttons ── */
    .btn-yt {
      background: #1f2937;
      color: #e2e8f0;
      border: 1px solid #374151;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-yt:hover { background: #374151; }

    .btn-gen {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff;
      border: none;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-gen:hover { opacity: 0.85; }
    .btn-gen:disabled { opacity: 0.5; cursor: not-allowed; }

    .script-box {
      margin-top: 20px;
      border-top: 1px solid #1e293b;
      padding-top: 20px;
    }
    .script-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #818cf8;
      font-size: 14px;
      padding: 16px 0;
    }
    .spinner {
      width: 20px; height: 20px;
      border: 2px solid #312e81;
      border-top-color: #818cf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .script-content {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 24px;
      font-size: 14px;
      line-height: 1.8;
      color: #cbd5e1;
      white-space: pre-wrap;
      font-family: 'Georgia', serif;
      max-height: 600px;
      overflow-y: auto;
    }
    .script-actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .btn-copy {
      background: #064e3b;
      color: #6ee7b7;
      border: 1px solid #065f46;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-copy:hover { background: #065f46; }

    .btn-teleprompter {
      background: #1e1b4b;
      color: #a5b4fc;
      border: 1px solid #312e81;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-teleprompter:hover { background: #312e81; }

    /* ── Repurposer ── */
    .repurposer {
      margin-top: 48px;
      padding-top: 32px;
      border-top: 2px solid #1e293b;
    }

    .repurposer textarea {
      width: 100%;
      background: #111827;
      border: 1px solid #374151;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 14px;
      line-height: 1.6;
      padding: 16px;
      resize: vertical;
      min-height: 140px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .repurposer textarea:focus { border-color: #6366f1; }
    .repurposer textarea::placeholder { color: #4b5563; }

    .btn-repurpose {
      margin-top: 12px;
      background: linear-gradient(135deg, #0f766e, #0891b2);
      color: #fff;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-repurpose:hover { opacity: 0.85; }
    .btn-repurpose:disabled { opacity: 0.5; cursor: not-allowed; }

    .posts-loading {
      display: none;
      align-items: center;
      gap: 12px;
      color: #22d3ee;
      font-size: 14px;
      padding: 16px 0;
    }

    .posts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 24px;
    }
    @media (max-width: 700px) { .posts-grid { grid-template-columns: 1fr; } }

    .post-card {
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 18px;
    }
    .post-card-label {
      font-size: 11px;
      font-weight: 700;
      color: #6366f1;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 10px;
    }
    .post-versions { display: flex; flex-direction: column; gap: 12px; }

    .post-version {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 6px;
      padding: 12px;
    }
    .post-platform {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 6px;
    }
    .post-platform.threads { color: #a78bfa; }
    .post-platform.x { color: #38bdf8; }

    .post-text {
      font-size: 13px;
      line-height: 1.6;
      color: #cbd5e1;
      white-space: pre-wrap;
      margin-bottom: 8px;
    }
    .post-chars {
      font-size: 11px;
      color: #4b5563;
      margin-bottom: 6px;
    }
    .btn-copy-post {
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-copy-post:hover { background: #334155; color: #e2e8f0; }

    @media (max-width: 600px) {
      header, main { padding: 16px 20px; }
      .date-bar { padding: 10px 20px; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">🎬</div>
  <div>
    <h1>Digital Marcia — Content Studio</h1>
    <p>Videos outlier detectados · Generador de guiones · Repurposer</p>
  </div>
</header>

<div class="date-bar">
  Último análisis: <span>${date || 'Sin datos aún'}</span>
  &nbsp;·&nbsp; ${videos.length} outliers encontrados
</div>

<main>
  <div class="section-title">🚀 Outliers del día</div>
  ${cards}

  <!-- ── MÓDULO E: Repurposer ── -->
  <div class="repurposer">
    <div class="section-title">♻️ Repurposer — Threads &amp; X</div>
    <textarea id="repurpose-input" placeholder="Pega aquí el guion completo o el título del video que quieres convertir en posts..."></textarea>
    <br/>
    <button class="btn-repurpose" onclick="generatePosts()">⚡ Generar 6 posts</button>
    <div class="posts-loading" id="posts-loading">
      <div class="spinner" style="border-top-color:#22d3ee;"></div>
      <span>Generando posts con Claude...</span>
    </div>
    <div class="posts-grid" id="posts-grid"></div>
  </div>
</main>

<script>
  const videos = ${JSON.stringify(videos)};

  // ── Script Generator ──────────────────────────────────────────────────────
  async function generateScript(index) {
    const v = videos[index];
    const btn = document.querySelector(\`[data-index="\${index}"] .btn-gen\`);
    const box = document.getElementById(\`script-\${index}\`);
    const loading = document.getElementById(\`loading-\${index}\`);
    const content = document.getElementById(\`content-\${index}\`);
    const actions = document.getElementById(\`script-actions-\${index}\`);

    btn.disabled = true;
    btn.textContent = '⏳ Generando...';
    box.style.display = 'block';
    loading.style.display = 'flex';
    content.textContent = '';
    actions.style.display = 'none';

    try {
      const res = await fetch('/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: v.title, channel: v.channel, score: v.score, url: v.url }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al generar guion');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      loading.style.display = 'none';
      let full = '';
      let streamError = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) { streamError = json.error; break; }
            if (json.text) {
              full += json.text;
              content.textContent = full;
              content.scrollTop = content.scrollHeight;
            }
          } catch {}
        }
        if (streamError) break;
      }

      if (streamError) throw new Error(streamError);
      if (!full) throw new Error('El modelo no devolvió contenido.');

      actions.style.display = 'flex';
      btn.textContent = '✅ Guion generado';
      document.getElementById('repurpose-input').value = full;
    } catch (err) {
      loading.style.display = 'none';
      btn.disabled = false;
      btn.textContent = '✨ Generar guion';
      content.textContent = '❌ Error: ' + err.message;
    }
  }

  function copyScript(index) {
    const content = document.getElementById(\`content-\${index}\`);
    navigator.clipboard.writeText(content.textContent).then(() => {
      const btns = document.querySelectorAll(\`#script-actions-\${index} .btn-copy\`);
      btns.forEach(b => { b.textContent = '✅ Copiado!'; setTimeout(() => { b.textContent = '📋 Copiar guion'; }, 2000); });
    });
  }

  function openTeleprompter(index) {
    const content = document.getElementById(\`content-\${index}\`);
    localStorage.setItem('teleprompter_script', content.textContent);
    window.open('/teleprompter', '_blank');
  }

  // ── Repurposer ────────────────────────────────────────────────────────────
  const POST_LABELS = [
    'El dato sorprendente',
    'La historia personal',
    'La reflexión sobre trabajar online',
    'El contraste nómada vs corporativo',
    'El consejo práctico',
    'La pregunta que genera debate',
  ];

  async function generatePosts() {
    const input = document.getElementById('repurpose-input').value.trim();
    if (!input) { alert('Pega el guion o título primero.'); return; }

    const btn = document.querySelector('.btn-repurpose');
    const loading = document.getElementById('posts-loading');
    const grid = document.getElementById('posts-grid');

    btn.disabled = true;
    btn.textContent = '⏳ Generando...';
    loading.style.display = 'flex';
    grid.innerHTML = '';

    try {
      const res = await fetch('/generate-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar posts');

      loading.style.display = 'none';
      grid.innerHTML = data.posts.map((post, i) => \`
        <div class="post-card">
          <div class="post-card-label">\${POST_LABELS[i] || 'Post \${i + 1}'}</div>
          <div class="post-versions">
            <div class="post-version">
              <div class="post-platform threads">Threads</div>
              <div class="post-text" id="pt-\${i}">\${post.threads}</div>
              <div class="post-chars">\${post.threads.length} / 500 chars</div>
              <button class="btn-copy-post" onclick="copyPost('pt-\${i}', this)">Copiar</button>
            </div>
            <div class="post-version">
              <div class="post-platform x">X / Twitter</div>
              <div class="post-text" id="px-\${i}">\${post.x}</div>
              <div class="post-chars">\${post.x.length} / 280 chars</div>
              <button class="btn-copy-post" onclick="copyPost('px-\${i}', this)">Copiar</button>
            </div>
          </div>
        </div>
      \`).join('');
    } catch (err) {
      loading.style.display = 'none';
      grid.innerHTML = \`<p style="color:#f87171;">❌ \${err.message}</p>\`;
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Generar 6 posts';
    }
  }

  function copyPost(id, btn) {
    const text = document.getElementById(id).textContent;
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅ Copiado';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
  }
</script>

</body>
</html>`;

  res.send(html);
});

// ── GET /teleprompter ──────────────────────────────────────────────────────────
app.get('/teleprompter', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Teleprompter — Digital Marcia</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #000;
      color: #fff;
      font-family: 'Georgia', serif;
      overflow: hidden;
      height: 100vh;
    }

    /* ── Controls bar ── */
    #controls {
      position: fixed;
      top: 0; left: 0; right: 0;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #222;
      padding: 10px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      z-index: 100;
      flex-wrap: wrap;
    }

    #controls button {
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #333;
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    #controls button:hover { background: #333; }
    #controls button.active { background: #4f46e5; border-color: #6366f1; }

    .ctrl-group {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #999;
    }

    #speed-slider {
      -webkit-appearance: none;
      width: 100px;
      height: 4px;
      border-radius: 2px;
      background: #333;
      outline: none;
    }
    #speed-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px; height: 16px;
      border-radius: 50%;
      background: #6366f1;
      cursor: pointer;
    }

    #font-size-display {
      min-width: 36px;
      text-align: center;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
    }

    .sep { width: 1px; height: 24px; background: #333; }

    /* ── Script ── */
    #scroll-container {
      position: fixed;
      top: 60px; left: 0; right: 0; bottom: 0;
      overflow: hidden;
    }

    #script {
      padding: 60px 15vw;
      font-size: 28px;
      line-height: 1.7;
      color: #ffffff;
      white-space: pre-wrap;
      will-change: transform;
    }

    #empty-msg {
      text-align: center;
      padding: 80px 40px;
      color: #555;
      font-size: 20px;
    }

    /* ── Mirror overlay (fades top/bottom) ── */
    #fade-top {
      position: fixed;
      top: 60px; left: 0; right: 0;
      height: 80px;
      background: linear-gradient(to bottom, #000, transparent);
      pointer-events: none;
      z-index: 10;
    }
    #fade-bottom {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 80px;
      background: linear-gradient(to top, #000, transparent);
      pointer-events: none;
      z-index: 10;
    }
  </style>
</head>
<body>

<div id="controls">
  <button id="btn-play" onclick="togglePlay()" class="active">⏸ Pausa</button>

  <div class="sep"></div>

  <div class="ctrl-group">
    <span>Velocidad</span>
    <input type="range" id="speed-slider" min="1" max="10" value="3" oninput="updateSpeed(this.value)"/>
    <span id="speed-val">3</span>
  </div>

  <div class="sep"></div>

  <div class="ctrl-group">
    <span>Tamaño</span>
    <button onclick="changeFontSize(-2)">−</button>
    <span id="font-size-display">28px</span>
    <button onclick="changeFontSize(2)">+</button>
  </div>

  <div class="sep"></div>

  <button onclick="resetScroll()">↩ Reiniciar</button>
</div>

<div id="fade-top"></div>
<div id="scroll-container">
  <div id="script"></div>
</div>
<div id="fade-bottom"></div>

<script>
  let playing = true;
  let speed = 3;
  let fontSize = 28;
  let scrollY = 0;
  let raf = null;
  let lastTime = null;

  const scriptEl = document.getElementById('script');
  const container = document.getElementById('scroll-container');
  const btnPlay = document.getElementById('btn-play');

  // Load script from localStorage
  const text = localStorage.getItem('teleprompter_script') || '';
  if (text) {
    scriptEl.textContent = text;
  } else {
    scriptEl.innerHTML = '<div id="empty-msg">No hay guion cargado.<br>Genera un guion en la app principal y abre el teleprompter desde ahí.</div>';
  }

  function updateSpeed(val) {
    speed = Number(val);
    document.getElementById('speed-val').textContent = val;
  }

  function changeFontSize(delta) {
    fontSize = Math.min(72, Math.max(18, fontSize + delta));
    scriptEl.style.fontSize = fontSize + 'px';
    document.getElementById('font-size-display').textContent = fontSize + 'px';
  }

  function togglePlay() {
    playing = !playing;
    if (playing) {
      btnPlay.textContent = '⏸ Pausa';
      btnPlay.classList.add('active');
      lastTime = null;
      raf = requestAnimationFrame(scroll);
    } else {
      btnPlay.textContent = '▶ Play';
      btnPlay.classList.remove('active');
      cancelAnimationFrame(raf);
    }
  }

  function resetScroll() {
    scrollY = 0;
    container.scrollTop = 0;
  }

  function scroll(ts) {
    if (lastTime === null) lastTime = ts;
    const delta = ts - lastTime;
    lastTime = ts;

    // speed 1 = 20px/s, speed 10 = 200px/s
    const pxPerMs = (speed * 20) / 1000;
    scrollY += pxPerMs * delta;
    container.scrollTop = scrollY;

    // Stop at bottom
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (scrollY >= maxScroll) {
      scrollY = maxScroll;
      playing = false;
      btnPlay.textContent = '▶ Play';
      btnPlay.classList.remove('active');
      return;
    }

    if (playing) raf = requestAnimationFrame(scroll);
  }

  // Start scrolling
  raf = requestAnimationFrame(scroll);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowUp') updateSpeed(Math.max(1, speed - 1));
    if (e.code === 'ArrowDown') updateSpeed(Math.min(10, speed + 1));
    if (e.code === 'KeyR') resetScroll();
    document.getElementById('speed-slider').value = speed;
    document.getElementById('speed-val').textContent = speed;
  });
</script>

</body>
</html>`;
  res.send(html);
});

// ── POST /run-now ──────────────────────────────────────────────────────────────
app.post('/run-now', async (req, res) => {
  const secret = process.env.RUN_SECRET;
  if (!secret || req.headers['x-secret'] !== secret) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  res.json({ ok: true, message: 'Análisis iniciado en segundo plano.' });
  try {
    const { runAnalysis } = require('./analyzer');
    await runAnalysis();
  } catch (err) {
    console.error('Error en /run-now:', err.message);
  }
});

// ── POST /generate-script ──────────────────────────────────────────────────────
app.post('/generate-script', async (req, res) => {
  const { videoTitle, channel, score, url } = req.body;
  if (!videoTitle || !channel) return res.status(400).json({ error: 'Faltan campos requeridos.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });

  const prompt = `VIDEO OUTLIER A ADAPTAR:
Título: ${videoTitle}
Canal: ${channel}
Score: ${score}x el promedio del canal
URL: ${url}

Genera un guion completo para YouTube (8-12 minutos) adaptando el tema de ese video a MI perspectiva y experiencia real, usando este framework de 7 pasos:

1. PATTERN INTERRUPTION (primeros 3 segundos): algo que rompa el patrón y detenga el scroll
2. MIRROR TO VIEWER: hablarle directamente, que se vea reflejado
3. REVEAL THE OPPORTUNITY: mostrar qué van a aprender
4. EXPOSE THE GAP/CURIOSITY: crear tensión o pregunta sin respuesta
5. PROMISE THE TRANSFORMATION: qué van a poder hacer/saber al final
6. AUTHORITY: quién soy yo para contarles esto (sin sonar arrogante)
7. TRANSITION AL CONTENIDO: entrada natural al tema

Después del hook, desarrolla el contenido completo del video con datos reales, experiencias concretas mías, y termina con un CTA: "Sígueme para más sobre vivir en [país] sin filtros".

El guion debe estar listo para leer como teleprompter.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: brandBlueprint,
      messages: [{ role: 'user', content: prompt }],
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── POST /generate-posts ───────────────────────────────────────────────────────
app.post('/generate-posts', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Falta el contenido.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });

  const prompt = `Basándote en este contenido:
---
${content.slice(0, 4000)}
---

Genera exactamente 6 posts para redes sociales con mi voz. Cada uno debe tener:
- Una versión para Threads (máximo 500 caracteres)
- Una versión para X/Twitter (máximo 280 caracteres, más concisa y directa)

Los 6 posts deben ser:
1. El dato sorprendente (un número, hecho o dato que nadie esperaría)
2. La historia personal (un momento concreto que Marcia vivió relacionado al tema)
3. La reflexión sobre trabajar online (lo real, no el marketing de lifestyle)
4. El contraste nómada vs corporativo (sin romantizar ninguno de los dos)
5. El consejo práctico (algo accionable, específico, que la gente pueda usar hoy)
6. La pregunta que genera debate (que invite a responder en los comentarios)

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta, sin texto antes ni después:
{
  "posts": [
    { "threads": "texto para threads", "x": "texto para x" },
    { "threads": "texto para threads", "x": "texto para x" },
    { "threads": "texto para threads", "x": "texto para x" },
    { "threads": "texto para threads", "x": "texto para x" },
    { "threads": "texto para threads", "x": "texto para x" },
    { "threads": "texto para threads", "x": "texto para x" }
  ]
}`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: brandBlueprint,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function startServer() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Servidor web en http://localhost:${port}`);
  });
}

module.exports = { startServer };
