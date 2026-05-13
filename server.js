require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { loadOutliersFromRedis, trackUsage, getUsageSummary, getUsageHistory, getDailyTotals, saveChannels, loadChannels } = require('./redis');

const brandBlueprint = fs.readFileSync('./brand-blueprint.md', 'utf8');
const storiesBank = fs.readFileSync('./stories-bank.md', 'utf8');
const systemPrompt = `${brandBlueprint}\n\nBANCO DE HISTORIAS REALES:\n${storiesBank}`;

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
  const [{ date, videos }, usage] = await Promise.all([readOutliers(), getUsageSummary()]);

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
          <button class="btn-gen" id="btn-gen-${i}" onclick="startGenerate(${i})">✨ Generar guion</button>
        </div>

        <!-- Selector tipo de contenido -->
        <div class="format-selector" id="format-sel-${i}" style="display:none;">
          <p class="sel-label">¿Qué tipo de contenido quieres generar?</p>
          <div class="sel-buttons">
            <button class="sel-btn" onclick="selectFormat(${i}, 'long')">
              <span class="sel-icon">📹</span>
              <span class="sel-title">Video largo YouTube</span>
              <span class="sel-sub">8-12 min · Framework 7 hooks</span>
              <span class="cost-est">~$0.05</span>
            </button>
            <button class="sel-btn" onclick="selectFormat(${i}, 'short')">
              <span class="sel-icon">⚡</span>
              <span class="sel-title">Short / Reel / TikTok</span>
              <span class="sel-sub">60-90 seg · Hook + desarrollo + CTA</span>
              <span class="cost-est">~$0.02 por short</span>
            </button>
          </div>
        </div>

        <!-- Selector cantidad de shorts -->
        <div class="qty-selector" id="qty-sel-${i}" style="display:none;">
          <p class="sel-label">¿Cuántos shorts quieres generar?</p>
          <div class="qty-buttons">
            <button class="qty-btn" onclick="generateShorts(${i}, 1)">1</button>
            <button class="qty-btn" onclick="generateShorts(${i}, 2)">2</button>
            <button class="qty-btn" onclick="generateShorts(${i}, 3)">3</button>
          </div>
        </div>

        <!-- Video largo -->
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

        <!-- Shorts -->
        <div class="shorts-box" id="shorts-${i}" style="display:none;">
          <div class="script-loading" id="shorts-loading-${i}" style="display:none;">
            <div class="spinner"></div><span>Generando shorts con Claude...</span>
          </div>
          <div id="shorts-content-${i}"></div>
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

    .usage-badge {
      margin-left: auto;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 12px;
      color: #94a3b8;
      white-space: nowrap;
    }
    .usage-badge a { color: #818cf8; text-decoration: none; }
    .usage-badge a:hover { text-decoration: underline; }
    .cost-est {
      font-size: 11px;
      color: #4b5563;
      margin-left: 6px;
    }

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

    /* ── Format / Quantity selectors ── */
    .format-selector, .qty-selector {
      margin-top: 16px;
      padding: 16px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 10px;
    }
    .sel-label {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .sel-buttons { display: flex; gap: 12px; flex-wrap: wrap; }
    .sel-btn {
      flex: 1;
      min-width: 160px;
      background: #1e293b;
      border: 2px solid #334155;
      border-radius: 10px;
      padding: 14px 16px;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.2s, background 0.2s;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sel-btn:hover { border-color: #6366f1; background: #1e1b4b; }
    .sel-icon { font-size: 22px; }
    .sel-title { font-size: 14px; font-weight: 700; color: #e2e8f0; }
    .sel-sub { font-size: 12px; color: #64748b; }

    .qty-buttons { display: flex; gap: 10px; }
    .qty-btn {
      width: 56px; height: 56px;
      background: #1e293b;
      border: 2px solid #334155;
      border-radius: 10px;
      color: #e2e8f0;
      font-size: 20px;
      font-weight: 800;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .qty-btn:hover { border-color: #f59e0b; background: #1c1a0e; color: #fbbf24; }

    /* ── Short cards ── */
    .short-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 14px;
    }
    .short-card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .short-num {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #000;
      font-size: 12px;
      font-weight: 900;
      padding: 3px 10px;
      border-radius: 99px;
    }
    .short-filming {
      font-size: 12px;
      color: #64748b;
      background: #1e293b;
      padding: 3px 10px;
      border-radius: 99px;
    }
    .short-section {
      margin-bottom: 12px;
    }
    .short-section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #f59e0b;
      margin-bottom: 4px;
    }
    .short-text {
      font-size: 14px;
      line-height: 1.7;
      color: #cbd5e1;
      white-space: pre-wrap;
      font-family: 'Georgia', serif;
    }
    .short-copy-btn {
      margin-top: 10px;
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .short-copy-btn:hover { background: #334155; color: #e2e8f0; }

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

    /* ── Modal canales ── */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
      z-index: 1000; align-items: center; justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #111827; border: 1px solid #1e293b; border-radius: 14px;
      width: 100%; max-width: 520px; max-height: 90vh; display: flex;
      flex-direction: column; overflow: hidden;
    }
    .modal-header {
      padding: 20px 24px 16px; border-bottom: 1px solid #1e293b;
      display: flex; align-items: center; justify-content: space-between;
    }
    .modal-header h3 { font-size: 16px; font-weight: 700; color: #e2e8f0; }
    .modal-close { background: none; border: none; color: #4b5563; font-size: 20px; cursor: pointer; line-height: 1; }
    .modal-close:hover { color: #e2e8f0; }
    .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
    .modal-footer { padding: 16px 24px; border-top: 1px solid #1e293b; display: flex; gap: 10px; justify-content: flex-end; }

    .search-row { display: flex; gap: 8px; margin-bottom: 12px; }
    .search-row input {
      flex: 1; background: #0f172a; border: 1px solid #374151; border-radius: 6px;
      color: #e2e8f0; font-size: 14px; padding: 8px 12px; outline: none;
      transition: border-color .2s;
    }
    .search-row input:focus { border-color: #6366f1; }
    .search-row input::placeholder { color: #4b5563; }
    .btn-search {
      background: #4f46e5; color: #fff; border: none; padding: 8px 16px;
      border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap;
    }
    .btn-search:hover { opacity: .85; }
    .btn-search:disabled { opacity: .5; cursor: not-allowed; }

    .channel-preview {
      background: #0f172a; border: 1px solid #1e293b; border-radius: 8px;
      padding: 12px 16px; display: flex; align-items: center; gap: 12px;
      margin-bottom: 12px;
    }
    .channel-preview img { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
    .channel-preview-info { flex: 1; }
    .channel-preview-name { font-size: 14px; font-weight: 600; color: #e2e8f0; }
    .channel-preview-id { font-size: 11px; color: #4b5563; margin-top: 2px; }
    .btn-add-ch {
      background: #064e3b; color: #6ee7b7; border: 1px solid #065f46;
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 700;
      cursor: pointer; white-space: nowrap;
    }
    .btn-add-ch:hover { background: #065f46; }

    .modal-section-label {
      font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;
      letter-spacing: .05em; margin-bottom: 10px;
    }
    .channel-list { display: flex; flex-direction: column; gap: 8px; }
    .channel-item {
      background: #0f172a; border: 1px solid #1e293b; border-radius: 8px;
      padding: 10px 14px; display: flex; align-items: center; gap: 10px;
    }
    .channel-item img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .channel-item-name { flex: 1; font-size: 13px; color: #cbd5e1; }
    .channel-item-id { font-size: 11px; color: #4b5563; }
    .btn-del {
      background: none; border: none; color: #4b5563; cursor: pointer;
      font-size: 16px; padding: 2px 4px; transition: color .2s; flex-shrink: 0;
    }
    .btn-del:hover { color: #f87171; }

    .btn-save-channels {
      background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff;
      border: none; padding: 10px 22px; border-radius: 6px; font-size: 14px;
      font-weight: 700; cursor: pointer; transition: opacity .2s;
    }
    .btn-save-channels:hover { opacity: .85; }
    .btn-cancel-modal { background: #1f2937; color: #94a3b8; border: 1px solid #374151; padding: 10px 18px; border-radius: 6px; font-size: 14px; cursor: pointer; }
    .btn-cancel-modal:hover { background: #374151; }

    .search-error { font-size: 13px; color: #f87171; padding: 8px 0; }

    .btn-manage-channels {
      background: #1f2937; color: #94a3b8; border: 1px solid #374151;
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; margin-left: auto; transition: background .2s;
    }
    .btn-manage-channels:hover { background: #374151; color: #e2e8f0; }

    .channel-modal {
      background: #111; border: 1px solid #2a2a2a; border-radius: 14px;
      width: 480px; max-width: 95vw; padding: 24px; color: #e2e8f0;
    }
    .ch-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 18px;
    }
    .ch-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; border-radius: 8px; background: #1a1a1a;
      margin-bottom: 6px; border: 1px solid #222;
    }
    .ch-item-info { display: flex; flex-direction: column; gap: 2px; }
    .ch-item-name { font-size: 14px; font-weight: 500; }
    .ch-item-id { font-size: 11px; color: #666; font-family: monospace; }
    .ch-remove-btn {
      background: none; border: none; color: #f87171; font-size: 16px;
      cursor: pointer; padding: 4px 8px; border-radius: 4px; line-height: 1;
    }
    .ch-remove-btn:hover { background: #2a1a1a; }

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
  <div class="usage-badge" id="usage-badge">
    💰 Hoy: <strong>$${usage.today.toFixed(4)}</strong> &nbsp;|&nbsp; Total: <strong>$${usage.total.toFixed(4)}</strong> &nbsp;<a href="/usage">↗ historial</a>
  </div>
</header>

<div class="date-bar">
  Último análisis: <span>${date || 'Sin datos aún'}</span>
  &nbsp;·&nbsp; ${videos.length} outliers encontrados
</div>

<main>
  <div class="section-title" style="justify-content:space-between;align-items:center;">
    <span>🚀 Outliers del día</span>
    <button class="btn-manage-channels" onclick="openChannelModal()">⚙️ Gestionar canales</button>
  </div>
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

  // ── Format selection flow ─────────────────────────────────────────────────
  function startGenerate(index) {
    const btn = document.getElementById(\`btn-gen-\${index}\`);
    btn.style.display = 'none';
    document.getElementById(\`format-sel-\${index}\`).style.display = 'block';
  }

  function selectFormat(index, format) {
    document.getElementById(\`format-sel-\${index}\`).style.display = 'none';
    if (format === 'long') {
      generateScript(index);
    } else {
      document.getElementById(\`qty-sel-\${index}\`).style.display = 'block';
    }
  }

  // ── Long script generator ─────────────────────────────────────────────────
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
            if (json.done && json.cost) {
              document.getElementById('usage-badge').innerHTML =
                '💰 Actualizando... <a href="/usage">↗ historial</a>';
              setTimeout(() => location.reload(), 1500);
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

  // ── Shorts generator ──────────────────────────────────────────────────────
  async function generateShorts(index, qty) {
    const v = videos[index];
    document.getElementById(\`qty-sel-\${index}\`).style.display = 'none';

    const box = document.getElementById(\`shorts-\${index}\`);
    const loading = document.getElementById(\`shorts-loading-\${index}\`);
    const contentEl = document.getElementById(\`shorts-content-\${index}\`);

    box.style.display = 'block';
    loading.style.display = 'flex';
    contentEl.innerHTML = '';

    try {
      const res = await fetch('/generate-shorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: v.title, channel: v.channel, score: v.score, url: v.url, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar shorts');

      loading.style.display = 'none';
      contentEl.innerHTML = data.shorts.map((s, i) => \`
        <div class="short-card">
          <div class="short-card-header">
            <span class="short-num">SHORT \${i + 1}</span>
            <span class="short-filming">\${s.filming}</span>
          </div>
          <div class="short-section">
            <div class="short-section-label">Hook — primeros 3 segundos</div>
            <div class="short-text">\${s.hook}</div>
          </div>
          <div class="short-section">
            <div class="short-section-label">Desarrollo</div>
            <div class="short-text">\${s.body}</div>
          </div>
          <div class="short-section">
            <div class="short-section-label">CTA</div>
            <div class="short-text">\${s.cta}</div>
          </div>
          <button class="short-copy-btn" onclick="copyShort(this, \\\`\${s.hook}\\\\n\\\\n\${s.body}\\\\n\\\\n\${s.cta}\\\`)">📋 Copiar short \${i + 1}</button>
        </div>
      \`).join('');
    } catch (err) {
      loading.style.display = 'none';
      contentEl.innerHTML = \`<p style="color:#f87171;padding:12px;">❌ \${err.message}</p>\`;
    }
  }

  function copyShort(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅ Copiado';
      setTimeout(() => { btn.textContent = btn.textContent.replace('✅ Copiado', '📋 Copiar short'); }, 2000);
    });
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

  // ── CHANNEL MANAGER ──
  let channelList = [];

  async function openChannelModal() {
    document.getElementById('channel-modal-overlay').style.display = 'flex';
    document.getElementById('ch-search-input').value = '';
    document.getElementById('ch-preview').style.display = 'none';
    document.getElementById('ch-msg').textContent = '';
    await loadCurrentChannels();
  }

  function closeChannelModal() {
    document.getElementById('channel-modal-overlay').style.display = 'none';
  }

  async function loadCurrentChannels() {
    try {
      const res = await fetch('/channels');
      const data = await res.json();
      channelList = data.channels || [];
      renderChannelList();
    } catch {
      document.getElementById('ch-msg').textContent = 'Error al cargar canales.';
    }
  }

  function renderChannelList() {
    const el = document.getElementById('ch-current-list');
    if (channelList.length === 0) {
      el.innerHTML = '<p style="color:#888;font-size:13px;">No hay canales guardados.</p>';
      return;
    }
    el.innerHTML = channelList.map((c, i) => \`
      <div class="ch-item">
        <div class="ch-item-info">
          <span class="ch-item-name">\${c.name || c.channelId || c.id}</span>
          <span class="ch-item-id">\${c.channelId || c.id || ''}</span>
        </div>
        <button class="ch-remove-btn" onclick="removeChannel(\${i})">✕</button>
      </div>
    \`).join('');
  }

  async function searchChannel() {
    const query = document.getElementById('ch-search-input').value.trim();
    if (!query) return;
    const btn = document.getElementById('ch-search-btn');
    btn.textContent = 'Buscando...';
    btn.disabled = true;
    document.getElementById('ch-preview').style.display = 'none';
    document.getElementById('ch-msg').textContent = '';
    try {
      const res = await fetch('/channels/search?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (data.error) {
        document.getElementById('ch-msg').textContent = data.error;
      } else {
        document.getElementById('ch-preview-name').textContent = data.name;
        document.getElementById('ch-preview-id').textContent = data.channelId;
        document.getElementById('ch-preview-subs').textContent = data.subscribers ? parseInt(data.subscribers).toLocaleString() + ' subs' : '';
        document.getElementById('ch-preview').style.display = 'flex';
        document.getElementById('ch-preview').dataset.channelId = data.channelId;
        document.getElementById('ch-preview').dataset.channelName = data.name;
      }
    } catch {
      document.getElementById('ch-msg').textContent = 'Error al buscar canal.';
    }
    btn.textContent = 'Buscar';
    btn.disabled = false;
  }

  function addChannel() {
    const preview = document.getElementById('ch-preview');
    const channelId = preview.dataset.channelId;
    const name = preview.dataset.channelName;
    if (!channelId) return;
    if (channelList.some(c => (c.channelId || c.id) === channelId)) {
      document.getElementById('ch-msg').textContent = 'Este canal ya está en la lista.';
      return;
    }
    channelList.push({ name, channelId });
    renderChannelList();
    preview.style.display = 'none';
    document.getElementById('ch-search-input').value = '';
    document.getElementById('ch-msg').textContent = '';
  }

  function removeChannel(i) {
    channelList.splice(i, 1);
    renderChannelList();
  }

  async function saveChannels() {
    const btn = document.getElementById('ch-save-btn');
    btn.textContent = 'Guardando...';
    btn.disabled = true;
    document.getElementById('ch-msg').textContent = '';
    try {
      const res = await fetch('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: channelList }),
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('ch-msg').textContent = '✅ Canales guardados. El próximo análisis usará esta lista.';
        document.getElementById('ch-msg').style.color = '#4ade80';
      } else {
        document.getElementById('ch-msg').textContent = data.error || 'Error al guardar.';
        document.getElementById('ch-msg').style.color = '#f87171';
      }
    } catch {
      document.getElementById('ch-msg').textContent = 'Error de red al guardar.';
      document.getElementById('ch-msg').style.color = '#f87171';
    }
    btn.textContent = '💾 Guardar cambios';
    btn.disabled = false;
  }

  document.getElementById('ch-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchChannel();
  });
</script>

<!-- CHANNEL MANAGER MODAL -->
<div id="channel-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center;">
  <div class="channel-modal">
    <div class="ch-modal-header">
      <h2 style="margin:0;font-size:18px;">⚙️ Gestionar canales</h2>
      <button onclick="closeChannelModal()" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;line-height:1;">✕</button>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <input id="ch-search-input" type="text" placeholder="@handle, nombre o URL del canal..." style="flex:1;padding:9px 12px;border-radius:8px;border:1px solid #333;background:#1a1a1a;color:#fff;font-size:14px;"/>
      <button id="ch-search-btn" onclick="searchChannel()" style="padding:9px 16px;border-radius:8px;background:#6366f1;color:#fff;border:none;cursor:pointer;font-size:14px;white-space:nowrap;">Buscar</button>
    </div>

    <div id="ch-preview" style="display:none;align-items:center;justify-content:space-between;background:#1a1a2e;border:1px solid #6366f1;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
      <div>
        <div id="ch-preview-name" style="font-weight:600;font-size:14px;"></div>
        <div style="display:flex;gap:12px;margin-top:3px;">
          <span id="ch-preview-id" style="font-size:11px;color:#888;font-family:monospace;"></span>
          <span id="ch-preview-subs" style="font-size:11px;color:#6366f1;"></span>
        </div>
      </div>
      <button onclick="addChannel()" style="padding:7px 14px;border-radius:6px;background:#6366f1;color:#fff;border:none;cursor:pointer;font-size:13px;">+ Agregar</button>
    </div>

    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">Canales actuales:</div>
    <div id="ch-current-list" style="max-height:240px;overflow-y:auto;margin-bottom:12px;"></div>

    <div id="ch-msg" style="font-size:13px;min-height:18px;margin-bottom:10px;"></div>

    <div style="display:flex;justify-content:flex-end;gap:10px;">
      <button onclick="closeChannelModal()" style="padding:9px 18px;border-radius:8px;background:#2a2a2a;color:#aaa;border:1px solid #333;cursor:pointer;font-size:14px;">Cancelar</button>
      <button id="ch-save-btn" onclick="saveChannels()" style="padding:9px 18px;border-radius:8px;background:#6366f1;color:#fff;border:none;cursor:pointer;font-size:14px;">💾 Guardar cambios</button>
    </div>
  </div>
</div>

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

// ── POST /generate-shorts ─────────────────────────────────────────────────────
app.post('/generate-shorts', async (req, res) => {
  const { videoTitle, channel, score, url, quantity = 1 } = req.body;
  if (!videoTitle || !channel) return res.status(400).json({ error: 'Faltan campos requeridos.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });

  const qty = Math.min(3, Math.max(1, parseInt(quantity, 10) || 1));

  const prompt = `Este video fue outlier: "${videoTitle}" — ${score}x el promedio del canal.
Identifica QUÉ tema o formato hizo que ese video funcionara.
Encuentra en el banco de historias reales de Marcia una experiencia equivalente o relacionada.
Genera ${qty} short(s) 100% original(es) basado(s) en ESA experiencia real.
NUNCA menciones el video original ni al creador original.
Si no hay historia real que encaje exactamente, usa el marcador [MARCIA: insertar experiencia real aquí] en ese punto.

Cada short debe durar 60-90 segundos cuando se lea en voz alta y ser independiente de los demás.

Para cada short incluye:
- hook: los primeros 3 segundos exactos que detienen el scroll (frase de impacto, pregunta perturbadora, o afirmación contraintuitiva — basada en experiencia real)
- body: desarrollo del contenido (60-75 seg) con dato concreto, costo real o experiencia específica de Marcia y Tomi, sin relleno
- cta: llamada a acción final (5-10 seg), variada entre los shorts si hay más de uno
- filming: UNA de estas opciones según el contenido: "Filmar in situ — exterior/calle" | "Filmar in situ — interior/habitación" | "A cámara directa — talking head"

Responde ÚNICAMENTE con JSON válido, sin texto antes ni después:
{
  "shorts": [
    {
      "hook": "texto del hook",
      "body": "texto del desarrollo",
      "cta": "texto del cta",
      "filming": "indicación de filmación"
    }
  ]
}`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    trackUsage('short', message.usage.input_tokens, message.usage.output_tokens).catch(() => {});
    res.json({ ...parsed, _cost: (message.usage.input_tokens / 1000 * 0.003 + message.usage.output_tokens / 1000 * 0.015).toFixed(4) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /generate-script ──────────────────────────────────────────────────────
app.post('/generate-script', async (req, res) => {
  const { videoTitle, channel, score, url } = req.body;
  if (!videoTitle || !channel) return res.status(400).json({ error: 'Faltan campos requeridos.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });

  const prompt = `Este video fue outlier: "${videoTitle}" — ${score}x el promedio del canal.
Identifica QUÉ tema o formato hizo que ese video funcionara.
Encuentra en el banco de historias reales de Marcia una experiencia equivalente o relacionada.
Genera contenido 100% original basado en ESA experiencia real.
NUNCA menciones el video original ni al creador original.
Si no hay historia real que encaje exactamente, usa el marcador [MARCIA: insertar experiencia real aquí] en ese punto.

Genera el guion completo para YouTube (8-12 minutos) usando este framework de 7 pasos:

1. PATTERN INTERRUPTION (primeros 3 segundos): algo que rompa el patrón y detenga el scroll
2. MIRROR TO VIEWER: hablarle directamente a la audiencia, que se vea reflejada
3. REVEAL THE OPPORTUNITY: mostrar qué van a aprender
4. EXPOSE THE GAP/CURIOSITY: crear tensión o pregunta sin respuesta
5. PROMISE THE TRANSFORMATION: qué van a poder hacer/saber al final
6. AUTHORITY: quién es Marcia para contarles esto (sin sonar arrogante)
7. TRANSITION AL CONTENIDO: entrada natural al tema

Después del hook, desarrolla el contenido completo con datos reales, costos concretos cuando aplique, y experiencias específicas de Marcia y Tomi. Termina con CTA: "Sígueme para más sobre vivir en [país] sin filtros".

El guion debe estar listo para leer como teleprompter.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    const final = await stream.finalMessage();
    const costUsd = (final.usage.input_tokens / 1000 * 0.003 + final.usage.output_tokens / 1000 * 0.015).toFixed(4);
    trackUsage('guion', final.usage.input_tokens, final.usage.output_tokens).catch(() => {});
    res.write(`data: ${JSON.stringify({ done: true, cost: costUsd })}\n\n`);
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
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    trackUsage('posts', message.usage.input_tokens, message.usage.output_tokens).catch(() => {});
    res.json({ ...parsed, _cost: (message.usage.input_tokens / 1000 * 0.003 + message.usage.output_tokens / 1000 * 0.015).toFixed(4) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /channels ─────────────────────────────────────────────────────────────
app.get('/channels', async (req, res) => {
  try {
    const fromRedis = await loadChannels();
    if (fromRedis) return res.json(fromRedis);
    const fromFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'channels.json'), 'utf-8'));
    res.json(fromFile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /channels ─────────────────────────────────────────────────────────────
app.post('/channels', async (req, res) => {
  const { channels } = req.body;
  if (!Array.isArray(channels)) return res.status(400).json({ error: 'Se esperaba un array de canales.' });

  try {
    await saveChannels(channels);
    // Also write to local file as backup
    fs.writeFileSync(path.join(__dirname, 'channels.json'), JSON.stringify(channels, null, 2));
    res.json({ ok: true, count: channels.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /channels/search ───────────────────────────────────────────────────────
app.get('/channels/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Falta el parámetro q.' });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY no configurada.' });

  // Parse handle from URL or @handle format
  let handle = q;
  const urlMatch = q.match(/youtube\.com\/@?([^/?&\s]+)/);
  if (urlMatch) handle = urlMatch[1];
  else handle = q.replace(/^@/, '');

  try {
    // Try forHandle first (works with @handles)
    try {
      const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet', forHandle: handle, key: apiKey },
      });
      if (r.data.items?.length > 0) {
        const ch = r.data.items[0];
        return res.json({
          channelId: ch.id,
          name: ch.snippet.title,
          thumbnail: ch.snippet.thumbnails?.default?.url || null,
        });
      }
    } catch {}

    // Fallback: search by query
    const r2 = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q: handle, type: 'channel', maxResults: 1, key: apiKey },
    });
    if (r2.data.items?.length > 0) {
      const ch = r2.data.items[0];
      return res.json({
        channelId: ch.snippet.channelId,
        name: ch.snippet.channelTitle,
        thumbnail: ch.snippet.thumbnails?.default?.url || null,
      });
    }

    res.status(404).json({ error: 'Canal no encontrado. Verifica el handle o URL.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /anthropic-usage ──────────────────────────────────────────────────────
app.get('/anthropic-usage', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const endDate = now.toISOString().split('T')[0];

  try {
    const response = await axios.get('https://api.anthropic.com/v1/usage', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      params: { start_date: startDate, end_date: endDate },
    });

    const data = response.data;
    let totalInput = 0;
    let totalOutput = 0;

    const entries = data.data || data.usage || [];
    entries.forEach(entry => {
      totalInput += entry.input_tokens || 0;
      totalOutput += entry.output_tokens || 0;
    });

    const costUsd = (totalInput / 1000 * 0.003) + (totalOutput / 1000 * 0.015);

    res.json({
      ok: true,
      period: { start: startDate, end: endDate },
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      cost_usd: Math.round(costUsd * 10000) / 10000,
      raw: entries,
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 || status === 404) {
      return res.json({
        ok: false,
        status,
        message: 'La API de Anthropic no permite consultar usage externamente — usa console.anthropic.com',
      });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /usage-summary ────────────────────────────────────────────────────────
app.get('/usage-summary', async (req, res) => {
  res.json(await getUsageSummary());
});

// ── GET /usage ────────────────────────────────────────────────────────────────
app.get('/usage', async (req, res) => {
  const [summary, history, daily] = await Promise.all([
    getUsageSummary(),
    getUsageHistory(50),
    getDailyTotals(7),
  ]);

  const maxCost = Math.max(...daily.map(d => d.cost), 0.001);

  const rows = history.map(e => `
    <tr>
      <td>${new Date(e.date).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><span class="type-badge type-${e.type}">${e.type}</span></td>
      <td>${e.input_tokens.toLocaleString()}</td>
      <td>${e.output_tokens.toLocaleString()}</td>
      <td class="cost-cell">$${e.cost_usd.toFixed(4)}</td>
    </tr>`).join('');

  const bars = daily.map(d => `
    <div class="bar-col">
      <div class="bar-wrap">
        <div class="bar" style="height:${Math.round((d.cost / maxCost) * 100)}%" title="$${d.cost.toFixed(4)}">
          <span class="bar-val">$${d.cost.toFixed(3)}</span>
        </div>
      </div>
      <div class="bar-label">${d.date.slice(5)}</div>
    </div>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Uso API — Digital Marcia</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0f; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    header { background: linear-gradient(135deg,#1a1033,#0f172a); border-bottom: 1px solid #1e293b; padding: 20px 40px; display:flex; align-items:center; gap:16px; }
    header h1 { font-size:20px; font-weight:800; background:linear-gradient(90deg,#a78bfa,#60a5fa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    header a { margin-left:auto; color:#818cf8; font-size:13px; text-decoration:none; }
    header a:hover { text-decoration:underline; }
    main { padding:32px 40px; max-width:900px; margin:0 auto; }
    .summary { display:flex; gap:16px; margin-bottom:32px; flex-wrap:wrap; }
    .stat { background:#111827; border:1px solid #1e293b; border-radius:10px; padding:20px 28px; flex:1; min-width:160px; }
    .stat-label { font-size:12px; color:#4b5563; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
    .stat-value { font-size:28px; font-weight:900; color:#a78bfa; }
    h2 { font-size:16px; font-weight:700; color:#e2e8f0; margin-bottom:16px; }
    /* Chart */
    .chart { display:flex; gap:8px; align-items:flex-end; height:120px; margin-bottom:32px; background:#111827; border:1px solid #1e293b; border-radius:10px; padding:16px; }
    .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; height:100%; }
    .bar-wrap { flex:1; width:100%; display:flex; align-items:flex-end; }
    .bar { width:100%; background:linear-gradient(180deg,#6366f1,#4f46e5); border-radius:4px 4px 0 0; position:relative; min-height:2px; transition:height .3s; }
    .bar-val { position:absolute; top:-18px; left:50%; transform:translateX(-50%); font-size:9px; color:#818cf8; white-space:nowrap; }
    .bar-label { font-size:10px; color:#4b5563; margin-top:6px; }
    /* Table */
    table { width:100%; border-collapse:collapse; background:#111827; border:1px solid #1e293b; border-radius:10px; overflow:hidden; }
    th { background:#1e293b; padding:10px 14px; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; text-align:left; }
    td { padding:10px 14px; font-size:13px; border-top:1px solid #1e293b; color:#cbd5e1; }
    .cost-cell { font-weight:700; color:#a78bfa; }
    .type-badge { padding:2px 8px; border-radius:99px; font-size:11px; font-weight:700; }
    .type-guion { background:#1e1b4b; color:#a5b4fc; }
    .type-short { background:#064e3b; color:#6ee7b7; }
    .type-posts { background:#1c1917; color:#d6d3d1; }
    /* Anthropic section */
    .api-section { background:#111827; border:1px solid #1e293b; border-radius:10px; padding:20px 24px; margin-bottom:32px; }
    .api-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .api-section-header h2 { margin:0; }
    .btn-refresh { background:#1e293b; color:#818cf8; border:1px solid #334155; padding:6px 14px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:background .2s; }
    .btn-refresh:hover { background:#334155; }
    .api-stats { display:flex; gap:12px; flex-wrap:wrap; }
    .api-stat { background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:14px 20px; flex:1; min-width:130px; }
    .api-stat-label { font-size:11px; color:#4b5563; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
    .api-stat-value { font-size:20px; font-weight:800; color:#60a5fa; }
    .api-notice { font-size:13px; color:#f87171; background:#1c0a0a; border:1px solid #7f1d1d; border-radius:8px; padding:12px 16px; }
    .api-loading { color:#4b5563; font-size:13px; }
  </style>
</head>
<body>
<header>
  <div style="font-size:24px">📊</div>
  <h1>Uso de API — Content Studio</h1>
  <a href="/">← Volver</a>
</header>
<main>

  <!-- Uso real Anthropic -->
  <div class="api-section">
    <div class="api-section-header">
      <h2>Uso real — Anthropic API</h2>
      <button class="btn-refresh" onclick="loadAnthropicUsage()">↻ Actualizar</button>
    </div>
    <div id="anthropic-usage-content"><p class="api-loading">Consultando API de Anthropic...</p></div>
  </div>

  <div class="summary">
    <div class="stat"><div class="stat-label">Gastado hoy</div><div class="stat-value">$${summary.today.toFixed(4)}</div></div>
    <div class="stat"><div class="stat-label">Total acumulado</div><div class="stat-value">$${summary.total.toFixed(4)}</div></div>
    <div class="stat"><div class="stat-label">Últimas generaciones</div><div class="stat-value">${history.length}</div></div>
  </div>

  <h2>Gasto últimos 7 días</h2>
  <div class="chart">${bars}</div>

  <h2>Historial de uso</h2>
  ${history.length === 0
    ? '<p style="color:#4b5563;padding:20px">Sin datos aún.</p>'
    : `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Input tokens</th><th>Output tokens</th><th>Costo</th></tr></thead><tbody>${rows}</tbody></table>`
  }
</main>
<script>
  async function loadAnthropicUsage() {
    const container = document.getElementById('anthropic-usage-content');
    container.innerHTML = '<p class="api-loading">Consultando API de Anthropic...</p>';
    try {
      const res = await fetch('/anthropic-usage');
      const data = await res.json();

      if (!data.ok) {
        container.innerHTML = \`<p class="api-notice">⚠️ \${data.message || data.error}</p>\`;
        return;
      }

      container.innerHTML = \`
        <p style="font-size:12px;color:#4b5563;margin-bottom:12px;">
          Período: \${data.period.start} → \${data.period.end}
        </p>
        <div class="api-stats">
          <div class="api-stat">
            <div class="api-stat-label">Input tokens</div>
            <div class="api-stat-value">\${data.total_input_tokens.toLocaleString()}</div>
          </div>
          <div class="api-stat">
            <div class="api-stat-label">Output tokens</div>
            <div class="api-stat-value">\${data.total_output_tokens.toLocaleString()}</div>
          </div>
          <div class="api-stat">
            <div class="api-stat-label">Costo estimado</div>
            <div class="api-stat-value" style="color:#a78bfa;">$\${data.cost_usd.toFixed(4)}</div>
          </div>
        </div>\`;
    } catch (err) {
      container.innerHTML = \`<p class="api-notice">❌ Error al consultar: \${err.message}</p>\`;
    }
  }

  loadAnthropicUsage();
</script>
</body>
</html>`);
});

function startServer() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Servidor web en http://localhost:${port}`);
  });
}

module.exports = { startServer };
