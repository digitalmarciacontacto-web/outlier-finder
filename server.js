require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { loadOutliersFromRedis, trackUsage, getUsageSummary, getUsageHistory, getDailyTotals, saveChannels, loadChannels, saveMetaToken, loadMetaToken, saveTikTokToken, loadTikTokToken } = require('./redis');

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
  const [{ date, videos }, usage, history] = await Promise.all([
    readOutliers(), getUsageSummary(), getUsageHistory(100),
  ]);

  const todayStr = new Date().toISOString().split('T')[0];
  const generationsToday = history.filter(h => h.date && h.date.startsWith(todayStr)).length;
  const topScore = videos.length > 0 ? videos[0].score : 0;

  function scoreClass(s) { return s >= 500 ? 'viral' : s >= 200 ? 'strong' : 'normal'; }
  function scoreBadgeClass(s) { return s >= 500 ? 'score-viral' : s >= 200 ? 'score-strong' : 'score-normal'; }
  function timeAgo(pub) {
    if (!pub) return '';
    const d = Math.floor((Date.now() - new Date(pub)) / 86400000);
    if (d === 0) return 'Hoy';
    if (d === 1) return 'Ayer';
    if (d < 7) return `Hace ${d} días`;
    if (d < 30) return `Hace ${Math.floor(d/7)} sem.`;
    if (d < 365) return `Hace ${Math.floor(d/30)} mes.`;
    return `Hace ${Math.floor(d/365)} año(s)`;
  }

  const topVideo = videos[0];
  const featuredCardHtml = !topVideo ? `
    <div class="empty-state">
      <p>No hay datos aún. Ejecuta el análisis para ver los outliers del día.</p>
    </div>` : `
    <div class="featured-card">
      <div class="featured-thumbnail">
        ${topVideo.thumbnail
          ? `<img src="${topVideo.thumbnail}" alt="" loading="lazy"/>`
          : `<div class="thumb-placeholder">▶</div>`}
      </div>
      <div class="featured-body">
        <div class="featured-score ${scoreClass(topVideo.score)}">${topVideo.score}<span>x</span></div>
        <div class="featured-title">${topVideo.title}</div>
        <div class="featured-meta"><strong>${topVideo.channel}</strong> · ${(topVideo.views/1000).toFixed(1)}K vistas · promedio ${(topVideo.channelAvg/1000).toFixed(1)}K</div>
        <div class="featured-actions">
          <a class="btn-yt" href="${topVideo.url}" target="_blank">▶ Ver video</a>
          <button class="btn-gen" onclick="showSection('outliers');setTimeout(()=>toggleCard(0),100)">✨ Generar guion</button>
        </div>
      </div>
    </div>`;

  function catBadgeClass(cat) {
    const map = { 'destino': 'cat-destino', 'finanzas': 'cat-finanzas', 'reinvención': 'cat-reinvencion', 'trabajo-remoto': 'cat-trabajo-remoto', 'lado-b': 'cat-lado-b', 'logistica': 'cat-logistica' };
    return map[cat] || 'cat-unknown';
  }
  function catLabel(cat) {
    const map = { 'destino': '🌍 Destino', 'finanzas': '💰 Finanzas', 'reinvención': '🔄 Reinvención', 'trabajo-remoto': '📱 Trabajo Remoto', 'lado-b': '😬 Lado B', 'logistica': '✈️ Logística' };
    return map[cat] || cat || '—';
  }

  const outlierCards = videos.length === 0
    ? `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#4b5563;">No hay outliers aún.</div>`
    : videos.map((v, i) => {
      const sc = scoreBadgeClass(v.score);
      const thumb = v.thumbnail
        ? `<img src="${v.thumbnail}" alt="" loading="lazy"/>`
        : `<div class="thumb-placeholder">▶</div>`;
      const catClass = catBadgeClass(v.category);
      const catText = catLabel(v.category);
      return `
      <div class="o-card" id="o-card-${i}" data-score="${v.score}" data-category="${v.category || ''}" data-published="${v.publishedAt || ''}" onclick="toggleCard(${i})">
        <div class="o-thumb">${thumb}<span class="o-score-badge ${sc}">${v.score}x</span></div>
        <div class="o-body">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;"><span class="cat-badge ${catClass}">${catText}</span></div>
          <div class="o-title">${v.title}</div>
          <div class="o-channel-small">${v.channel}</div>
          <div class="o-meta">👁 ${(v.views/1000).toFixed(1)}K · ${timeAgo(v.publishedAt)}</div>
          <div class="o-actions" onclick="event.stopPropagation()">
            <a class="btn-yt" href="${v.url}" target="_blank">▶ Ver</a>
            <button class="btn-gen" id="gen-btn-${i}" onclick="startGenerate(${i},event)">✨ Generar guion</button>
          </div>
        </div>
        <div class="o-expand" id="expand-${i}">
          <div class="o-expand-inner">
            <div class="pattern-loading" id="pattern-loading-${i}" style="display:none;">
              <div class="spinner"></div><span>Analizando patrón con Claude...</span>
            </div>
            <div id="pattern-${i}"></div>
            <div class="format-selector" id="format-sel-${i}" style="display:none;">
              <div class="sel-label">¿Qué tipo de contenido?</div>
              <div class="sel-buttons">
                <button class="sel-btn" onclick="selectFormat(${i},'long',event)">
                  <span class="sel-icon">📹</span>
                  <span class="sel-title">Video largo YouTube</span>
                  <span class="sel-sub">8-12 min · Framework 7 hooks</span>
                  <span class="cost-est">~$0.05</span>
                </button>
                <button class="sel-btn" onclick="selectFormat(${i},'short',event)">
                  <span class="sel-icon">⚡</span>
                  <span class="sel-title">Short / Reel / TikTok</span>
                  <span class="sel-sub">60-90 seg · Hook + CTA</span>
                  <span class="cost-est">~$0.02 por short</span>
                </button>
              </div>
            </div>
            <div class="qty-selector" id="qty-sel-${i}" style="display:none;">
              <div class="sel-label">¿Cuántos shorts?</div>
              <div class="qty-buttons">
                <button class="qty-btn" onclick="generateShorts(${i},1,event)">1</button>
                <button class="qty-btn" onclick="generateShorts(${i},2,event)">2</button>
                <button class="qty-btn" onclick="generateShorts(${i},3,event)">3</button>
              </div>
            </div>
            <div class="script-box" id="script-${i}" style="display:none;">
              <div class="script-loading" id="loading-${i}" style="display:none;">
                <div class="spinner"></div><span>Generando guion con Claude...</span>
              </div>
              <div class="script-content" id="content-${i}"></div>
              <div class="script-actions" id="script-actions-${i}" style="display:none;">
                <button class="btn-copy" onclick="copyScript(${i})">📋 Copiar guion</button>
                <button class="btn-teleprompter" onclick="openTeleprompter(${i})">📺 Teleprompter</button>
              </div>
            </div>
            <div class="shorts-box" id="shorts-${i}" style="display:none;">
              <div class="script-loading" id="shorts-loading-${i}" style="display:none;">
                <div class="spinner"></div><span>Generando shorts con Claude...</span>
              </div>
              <div id="shorts-content-${i}"></div>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Digital Marcia — Content Studio</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f0f0f; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }

    /* ── Header ── */
    #app-header { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: #111; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; padding: 0 32px; height: 56px; gap: 0; }
    .header-brand { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-right: 24px; }
    .header-logo { font-size: 20px; }
    .header-title { font-size: 15px; font-weight: 700; background: linear-gradient(90deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; white-space: nowrap; }
    .header-nav { display: flex; gap: 2px; }
    .nav-tab { background: none; border: none; color: #6b7280; font-size: 14px; font-weight: 500; padding: 6px 14px; border-radius: 6px; cursor: pointer; transition: color .15s, background .15s; white-space: nowrap; }
    .nav-tab:hover { color: #e2e8f0; background: #1f1f1f; }
    .nav-tab.active { color: #a78bfa; background: #1e1b4b; font-weight: 700; }
    .header-cost { margin-left: auto; font-size: 13px; color: #6b7280; white-space: nowrap; background: #1a1a1a; border: 1px solid #2a2a2a; padding: 5px 12px; border-radius: 6px; }
    .header-cost strong { color: #a78bfa; }

    /* ── Layout ── */
    #app-body { margin-top: 56px; min-height: calc(100vh - 56px); }
    .section { display: none; padding: 32px; max-width: 1100px; margin: 0 auto; }
    .section.active { display: block; }

    /* ── HOY ── */
    .hoy-date { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
    .hoy-date span { color: #a78bfa; font-weight: 600; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .metric-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; margin-bottom: 8px; }
    .metric-value { font-size: 36px; font-weight: 800; color: #e2e8f0; line-height: 1; }
    .metric-value.viral { color: #ef4444; }
    .metric-value.strong { color: #f97316; }
    .featured-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; margin-bottom: 12px; }
    .featured-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; overflow: hidden; display: flex; margin-bottom: 24px; }
    .featured-thumbnail { width: 280px; flex-shrink: 0; background: #111; overflow: hidden; }
    .featured-thumbnail img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .featured-body { padding: 24px; flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .featured-score { display: inline-flex; align-items: center; gap: 6px; background: #ef4444; color: #fff; font-size: 24px; font-weight: 900; padding: 6px 14px; border-radius: 8px; width: fit-content; line-height: 1; }
    .featured-score span { font-size: 14px; opacity: .8; }
    .featured-score.strong { background: #f97316; }
    .featured-score.normal { background: #6b7280; }
    .featured-title { font-size: 20px; font-weight: 700; color: #e2e8f0; line-height: 1.4; }
    .featured-meta { font-size: 13px; color: #6b7280; }
    .featured-meta strong { color: #a78bfa; }
    .featured-actions { display: flex; gap: 10px; margin-top: auto; flex-wrap: wrap; }
    .btn-see-all { display: inline-flex; align-items: center; gap: 6px; background: #1a1a1a; border: 1px solid #2a2a2a; color: #a78bfa; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; transition: background .15s, border-color .15s; }
    .btn-see-all:hover { background: #1e1b4b; border-color: #4f46e5; }
    .empty-state { text-align: center; padding: 60px 20px; color: #4b5563; font-size: 14px; }

    /* ── OUTLIERS ── */
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
    .section-title { font-size: 20px; font-weight: 800; color: #e2e8f0; }
    .filter-row { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
    .filter-pill { background: #1a1a1a; border: 1px solid #2a2a2a; color: #6b7280; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s; }
    .filter-pill:hover { border-color: #6366f1; color: #a78bfa; }
    .filter-pill.active { background: #1e1b4b; border-color: #6366f1; color: #a78bfa; }
    .outliers-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .o-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; overflow: hidden; cursor: pointer; transition: border-color .2s; }
    .o-card:hover { border-color: #4f46e5; }
    .o-card.expanded { border-color: #6366f1; }
    .o-thumb { width: 100%; aspect-ratio: 16/9; background: #111; overflow: hidden; position: relative; }
    .o-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 32px; color: #2a2a2a; }
    .o-score-badge { position: absolute; top: 8px; left: 8px; font-size: 13px; font-weight: 800; padding: 3px 10px; border-radius: 6px; color: #fff; }
    .score-viral { background: #ef4444; }
    .score-strong { background: #f97316; }
    .score-normal { background: #6b7280; }
    .o-body { padding: 14px 16px; }
    .o-channel { font-size: 11px; color: #6366f1; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .o-title { font-size: 14px; font-weight: 600; color: #e2e8f0; line-height: 1.4; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .o-meta { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
    .o-actions { display: flex; gap: 8px; }
    .o-expand { display: none; padding: 0 16px 16px; border-top: 1px solid #2a2a2a; }
    .o-card.expanded .o-expand { display: block; }
    .o-expand-inner { padding-top: 14px; }
    .pattern-loading { display: flex; align-items: center; gap: 10px; color: #6366f1; font-size: 13px; padding: 8px 0; }
    .pattern-result { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
    .pattern-item { background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 10px 14px; }
    .pattern-item-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #6366f1; margin-bottom: 4px; }
    .pattern-item-value { font-size: 13px; color: #cbd5e1; line-height: 1.5; }

    /* ── Buttons ── */
    .btn-yt { background: #1f2937; color: #e2e8f0; border: 1px solid #374151; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; transition: background .2s; display: inline-flex; align-items: center; gap: 4px; }
    .btn-yt:hover { background: #374151; }
    .btn-gen { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; transition: opacity .2s; display: inline-flex; align-items: center; gap: 4px; }
    .btn-gen:hover { opacity: .85; }
    .btn-gen:disabled { opacity: .5; cursor: not-allowed; }
    .btn-manage-channels { background: #1f2937; color: #94a3b8; border: 1px solid #374151; padding: 7px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .2s; }
    .btn-manage-channels:hover { background: #374151; color: #e2e8f0; }

    /* ── Format/Qty selectors ── */
    .format-selector, .qty-selector { margin-top: 12px; padding: 14px; background: #111; border: 1px solid #2a2a2a; border-radius: 10px; }
    .sel-label { font-size: 11px; color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 10px; }
    .sel-buttons { display: flex; gap: 10px; flex-wrap: wrap; }
    .sel-btn { flex: 1; min-width: 130px; background: #1a1a1a; border: 2px solid #2a2a2a; border-radius: 8px; padding: 12px; cursor: pointer; text-align: left; transition: border-color .2s, background .2s; display: flex; flex-direction: column; gap: 3px; }
    .sel-btn:hover { border-color: #6366f1; background: #1e1b4b; }
    .sel-icon { font-size: 18px; }
    .sel-title { font-size: 13px; font-weight: 700; color: #e2e8f0; }
    .sel-sub { font-size: 11px; color: #6b7280; }
    .cost-est { font-size: 10px; color: #4b5563; margin-top: 2px; }
    .qty-buttons { display: flex; gap: 10px; }
    .qty-btn { width: 48px; height: 48px; background: #1a1a1a; border: 2px solid #2a2a2a; border-radius: 8px; color: #e2e8f0; font-size: 18px; font-weight: 800; cursor: pointer; transition: border-color .2s, background .2s; }
    .qty-btn:hover { border-color: #f59e0b; background: #1c1a0e; color: #fbbf24; }

    /* ── Script/spinner ── */
    .script-box { margin-top: 12px; }
    .script-loading { display: flex; align-items: center; gap: 10px; color: #818cf8; font-size: 13px; padding: 12px 0; }
    .spinner { width: 18px; height: 18px; border: 2px solid #312e81; border-top-color: #818cf8; border-radius: 50%; animation: spin .8s linear infinite; flex-shrink: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .script-content { background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.8; color: #cbd5e1; white-space: pre-wrap; font-family: 'Georgia', serif; max-height: 500px; overflow-y: auto; }
    .script-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .btn-copy { background: #064e3b; color: #6ee7b7; border: 1px solid #065f46; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .2s; }
    .btn-copy:hover { background: #065f46; }
    .btn-teleprompter { background: #1e1b4b; color: #a5b4fc; border: 1px solid #312e81; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .2s; }
    .btn-teleprompter:hover { background: #312e81; }

    /* ── Shorts ── */
    .short-card { background: #111; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
    .short-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .short-num { background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; font-size: 11px; font-weight: 900; padding: 3px 10px; border-radius: 99px; }
    .short-filming { font-size: 11px; color: #6b7280; background: #1a1a1a; padding: 3px 10px; border-radius: 99px; }
    .short-section { margin-bottom: 10px; }
    .short-section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #f59e0b; margin-bottom: 4px; }
    .short-text { font-size: 13px; line-height: 1.7; color: #cbd5e1; white-space: pre-wrap; font-family: 'Georgia', serif; }
    .short-copy-btn { background: #1a1a1a; color: #94a3b8; border: 1px solid #2a2a2a; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: background .2s; }
    .short-copy-btn:hover { background: #2a2a2a; color: #e2e8f0; }

    /* ── Repurposer ── */
    .repurposer-desc { color: #6b7280; font-size: 14px; margin-bottom: 16px; }
    .repurposer-textarea { width: 100%; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; color: #e2e8f0; font-size: 14px; line-height: 1.6; padding: 16px; resize: vertical; min-height: 140px; font-family: inherit; outline: none; transition: border-color .2s; }
    .repurposer-textarea:focus { border-color: #6366f1; }
    .repurposer-textarea::placeholder { color: #4b5563; }
    .btn-repurpose { margin-top: 12px; background: linear-gradient(135deg, #0f766e, #0891b2); color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; transition: opacity .2s; }
    .btn-repurpose:hover { opacity: .85; }
    .btn-repurpose:disabled { opacity: .5; cursor: not-allowed; }
    .posts-loading { display: none; align-items: center; gap: 12px; color: #22d3ee; font-size: 14px; padding: 16px 0; }
    .posts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; }
    .post-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; }
    .post-card-label { font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
    .post-versions { display: flex; flex-direction: column; gap: 10px; }
    .post-version { background: #111; border: 1px solid #2a2a2a; border-radius: 6px; padding: 12px; }
    .post-platform { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
    .post-platform.threads { color: #a78bfa; }
    .post-platform.x { color: #38bdf8; }
    .post-text { font-size: 13px; line-height: 1.6; color: #cbd5e1; white-space: pre-wrap; margin-bottom: 8px; }
    .post-chars { font-size: 11px; color: #4b5563; margin-bottom: 6px; }
    .btn-copy-post { background: #1a1a1a; color: #94a3b8; border: 1px solid #2a2a2a; padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; }
    .btn-copy-post:hover { background: #2a2a2a; color: #e2e8f0; }

    /* ── USO ── */
    .uso-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
    .uso-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px; }
    .uso-card-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; margin-bottom: 8px; }
    .uso-card-value { font-size: 36px; font-weight: 800; color: #a78bfa; }
    .uso-section-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; margin-bottom: 12px; margin-top: 28px; }
    .uso-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .uso-table th { text-align: left; color: #4b5563; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 8px 12px; border-bottom: 1px solid #2a2a2a; }
    .uso-table td { padding: 10px 12px; border-bottom: 1px solid #1f1f1f; color: #cbd5e1; }
    .uso-table tr:last-child td { border-bottom: none; }
    .uso-table tbody tr:hover td { background: #1f1f1f; }
    .type-badge-uso { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .type-guion { background: #1e1b4b; color: #a78bfa; }
    .type-short { background: #1c1a0e; color: #fbbf24; }
    .type-posts { background: #0a1628; color: #38bdf8; }

    /* ── Channel modal ── */
    #channel-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.75); backdrop-filter: blur(4px); z-index: 200; align-items: center; justify-content: center; }
    .channel-modal { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 14px; width: 480px; max-width: 95vw; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
    .ch-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px 16px; border-bottom: 1px solid #2a2a2a; }
    .ch-modal-header h2 { font-size: 16px; font-weight: 700; }
    .ch-modal-close { background: none; border: none; color: #6b7280; font-size: 20px; cursor: pointer; line-height: 1; }
    .ch-modal-close:hover { color: #e2e8f0; }
    .ch-modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
    .ch-modal-footer { padding: 16px 24px; border-top: 1px solid #2a2a2a; display: flex; gap: 10px; justify-content: flex-end; }
    .ch-search-row { display: flex; gap: 8px; margin-bottom: 12px; }
    .ch-search-row input { flex: 1; background: #111; border: 1px solid #2a2a2a; border-radius: 6px; color: #e2e8f0; font-size: 14px; padding: 8px 12px; outline: none; transition: border-color .2s; }
    .ch-search-row input:focus { border-color: #6366f1; }
    .ch-search-row input::placeholder { color: #4b5563; }
    .ch-preview { background: #111; border: 1px solid #6366f1; border-radius: 8px; padding: 10px 14px; display: none; align-items: center; gap: 12px; margin-bottom: 12px; }
    .ch-preview-name { font-size: 14px; font-weight: 600; }
    .ch-preview-id { font-size: 11px; color: #6b7280; font-family: monospace; }
    .ch-section-label { font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .ch-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
    .ch-item { background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; }
    .ch-item-name { flex: 1; font-size: 13px; color: #cbd5e1; }
    .ch-item-id { font-size: 11px; color: #4b5563; font-family: monospace; }
    .ch-remove-btn { background: none; border: none; color: #4b5563; font-size: 16px; cursor: pointer; padding: 2px 4px; transition: color .2s; }
    .ch-remove-btn:hover { color: #ef4444; }
    .ch-msg { font-size: 13px; min-height: 18px; margin-top: 10px; }
    .btn-search { background: #4f46e5; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .btn-search:hover { opacity: .85; }
    .btn-search:disabled { opacity: .5; cursor: not-allowed; }
    .btn-add-ch { background: #064e3b; color: #6ee7b7; border: 1px solid #065f46; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .btn-add-ch:hover { background: #065f46; }
    .btn-cancel-modal { background: #1f2937; color: #94a3b8; border: 1px solid #374151; padding: 9px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .btn-cancel-modal:hover { background: #374151; }
    .btn-save-channels { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; border: none; padding: 9px 18px; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .btn-save-channels:hover { opacity: .85; }

    /* ── Category badges ── */
    .cat-badge { display: inline-block; padding: 2px 9px; border-radius: 5px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
    .cat-destino      { background: #052e16; color: #4ade80; border: 1px solid #065f46; }
    .cat-finanzas     { background: #1c1a0e; color: #fbbf24; border: 1px solid #854d0e; }
    .cat-reinvencion  { background: #1e1b4b; color: #a78bfa; border: 1px solid #4c1d95; }
    .cat-trabajo-remoto { background: #0c1a2e; color: #60a5fa; border: 1px solid #1e3a5f; }
    .cat-lado-b       { background: #2d0f0f; color: #f87171; border: 1px solid #7f1d1d; }
    .cat-logistica    { background: #0a1e1e; color: #2dd4bf; border: 1px solid #134e4a; }
    .cat-unknown      { background: #1a1a1a; color: #6b7280; border: 1px solid #2a2a2a; }
    .o-channel-small { font-size: 10px; color: #4b5563; margin-top: 2px; }
    /* date filter row */
    .filter-date-row { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
    .filter-date-label { font-size: 11px; color: #4b5563; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; margin-right: 4px; }
    .filter-date-pill { background: #1a1a1a; border: 1px solid #2a2a2a; color: #6b7280; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; }
    .filter-date-pill:hover { border-color: #6366f1; color: #a78bfa; }
    .filter-date-pill.active { background: #0f172a; border-color: #38bdf8; color: #38bdf8; }

    /* ── MI CANAL ── */
    .canal-platforms-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px; }
    .platform-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
    .platform-card-header { display: flex; align-items: center; gap: 12px; }
    .platform-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
    .yt-icon { background: #ff0000; color: #fff; font-size: 16px; font-weight: 900; }
    .ig-icon { background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045); color: #fff; }
    .fb-icon { background: #1877f2; color: #fff; }
    .tt-icon { background: #010101; color: #fff; border: 1px solid #333; }
    .platform-name { font-size: 14px; font-weight: 700; color: #e2e8f0; }
    .platform-handle { font-size: 12px; color: #6b7280; }
    .platform-live-badge { margin-left: auto; background: #052e16; color: #4ade80; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: .05em; border: 1px solid #065f46; }
    .platform-followers { font-size: 28px; font-weight: 800; color: #e2e8f0; }
    .platform-status-msg { font-size: 12px; color: #4b5563; }
    .btn-connect { background: #1f2937; color: #4b5563; border: 1px solid #374151; padding: 7px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: not-allowed; width: fit-content; opacity: .6; transition: all .15s; }
    .btn-connect.active { background: #312e81; color: #c7d2fe; border-color: #4338ca; cursor: pointer; opacity: 1; }
    .btn-connect.active:hover { background: #3730a3; }
    .yt-loading { display: flex; align-items: center; gap: 10px; color: #6b7280; font-size: 13px; }
    .yt-quick-stats { display: flex; gap: 16px; }
    .yt-qstat { display: flex; flex-direction: column; gap: 2px; }
    .yt-qstat-val { font-size: 22px; font-weight: 800; color: #e2e8f0; }
    .yt-qstat-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
    .ypp-section { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 14px; padding: 20px; margin-bottom: 28px; }
    .ypp-title { font-size: 14px; font-weight: 700; color: #fbbf24; margin-bottom: 16px; }
    .ypp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .ypp-item-label { font-size: 11px; color: #6b7280; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
    .ypp-item-vals { font-size: 15px; font-weight: 700; color: #e2e8f0; margin-bottom: 10px; }
    .ypp-item-vals span { color: #a78bfa; }
    .progress-bar-wrap { background: #111; border-radius: 99px; height: 8px; overflow: hidden; margin-bottom: 6px; }
    .progress-bar-fill { height: 100%; border-radius: 99px; transition: width .5s ease; }
    .ypp-pct { font-size: 11px; font-weight: 700; }
    .ypp-note { font-size: 11px; color: #6b7280; margin-top: 4px; }
    .yt-expanded { margin-bottom: 28px; }
    .yt-section-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; margin-bottom: 14px; }
    .yt-video-list { display: flex; flex-direction: column; gap: 10px; }
    .yt-video-item { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; display: flex; align-items: center; gap: 14px; padding: 10px; overflow: hidden; }
    .yt-video-thumb { width: 120px; height: 68px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: #111; }
    .yt-video-thumb-placeholder { width: 120px; height: 68px; border-radius: 6px; background: #111; display: flex; align-items: center; justify-content: center; color: #2a2a2a; font-size: 24px; flex-shrink: 0; }
    .yt-video-body { flex: 1; min-width: 0; }
    .yt-video-title { font-size: 13px; font-weight: 600; color: #e2e8f0; line-height: 1.4; margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .yt-video-meta { font-size: 12px; color: #6b7280; display: flex; gap: 12px; flex-wrap: wrap; }
    .yt-video-rank { font-size: 18px; font-weight: 900; color: #2a2a2a; width: 32px; text-align: center; flex-shrink: 0; }
    .yt-top-card { background: #1a1a1a; border: 1px solid #fbbf24; border-radius: 12px; display: flex; gap: 16px; padding: 16px; overflow: hidden; }
    .yt-top-thumb { width: 180px; height: 102px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: #111; }
    .yt-top-body { flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .yt-top-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #fbbf24; }
    .yt-top-title { font-size: 16px; font-weight: 700; color: #e2e8f0; line-height: 1.4; }
    .yt-top-meta { font-size: 13px; color: #6b7280; }
    .yt-avg-row { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 14px 18px; display: flex; align-items: center; gap: 16px; margin-top: 10px; }
    .yt-avg-val { font-size: 24px; font-weight: 800; color: #a78bfa; }
    .yt-avg-label { font-size: 12px; color: #6b7280; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
      .featured-card { flex-direction: column; }
      .featured-thumbnail { width: 100%; height: 180px; }
      .outliers-grid { grid-template-columns: 1fr; }
      .posts-grid { grid-template-columns: 1fr; }
      .uso-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .section { padding: 20px 16px; }
      #app-header { padding: 0 16px; }
      .header-title { display: none; }
    }
  </style>
</head>
<body>

<header id="app-header">
  <div class="header-brand">
    <span class="header-logo">🎬</span>
    <span class="header-title">Digital Marcia — Content Studio</span>
  </div>
  <nav class="header-nav">
    <button class="nav-tab active" data-section="hoy" onclick="showSection('hoy')">Hoy</button>
    <button class="nav-tab" data-section="outliers" onclick="showSection('outliers')">Outliers</button>
    <button class="nav-tab" data-section="canal" onclick="showSection('canal')">Mi Canal</button>
    <button class="nav-tab" data-section="repurposer" onclick="showSection('repurposer')">Repurposer</button>
    <button class="nav-tab" data-section="uso" onclick="showSection('uso')">Uso</button>
  </nav>
  <div class="header-cost" id="header-cost">💰 <strong>$${usage.today.toFixed(4)}</strong> hoy</div>
</header>

<div id="app-body">

<!-- ── HOY ── -->
<section id="section-hoy" class="section active">
  <div class="hoy-date">
    Análisis del <span>${date || 'Sin datos aún'}</span> · ${videos.length} outliers encontrados
  </div>
  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Mejor score</div>
      <div class="metric-value ${topScore >= 500 ? 'viral' : topScore >= 200 ? 'strong' : ''}">${topScore}x</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total outliers</div>
      <div class="metric-value">${videos.length}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Canales monitoreados</div>
      <div class="metric-value" id="metric-channels">—</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Generaciones hoy</div>
      <div class="metric-value">${generationsToday}</div>
    </div>
  </div>
  ${videos.length > 0 ? '<div class="featured-label">⭐ Outlier #1 del día</div>' : ''}
  ${featuredCardHtml}
  ${videos.length > 0 ? '<button class="btn-see-all" onclick="showSection(\'outliers\')">Ver todos los outliers →</button>' : ''}
</section>

<!-- ── OUTLIERS ── -->
<section id="section-outliers" class="section">
  <div class="section-header">
    <h2 class="section-title">📊 Outlier Feed</h2>
    <button class="btn-manage-channels" onclick="openChannelModal()">⚙️ Gestionar canales</button>
  </div>
  <div class="filter-row">
    <button class="filter-pill active" data-topic="all" onclick="setTopic('all',this)">Todos</button>
    <button class="filter-pill" data-topic="destino" onclick="setTopic('destino',this)">🌍 Destino</button>
    <button class="filter-pill" data-topic="finanzas" onclick="setTopic('finanzas',this)">💰 Finanzas</button>
    <button class="filter-pill" data-topic="reinvención" onclick="setTopic('reinvención',this)">🔄 Reinvención</button>
    <button class="filter-pill" data-topic="trabajo-remoto" onclick="setTopic('trabajo-remoto',this)">📱 Trabajo Remoto</button>
    <button class="filter-pill" data-topic="lado-b" onclick="setTopic('lado-b',this)">😬 Lado B</button>
    <button class="filter-pill" data-topic="logistica" onclick="setTopic('logistica',this)">✈️ Logística</button>
  </div>
  <div class="filter-date-row">
    <span class="filter-date-label">Fecha:</span>
    <button class="filter-date-pill active" data-days="0" onclick="setDate(0,this)">Todos</button>
    <button class="filter-date-pill" data-days="7" onclick="setDate(7,this)">7 días</button>
    <button class="filter-date-pill" data-days="30" onclick="setDate(30,this)">1 mes</button>
    <button class="filter-date-pill" data-days="365" onclick="setDate(365,this)">1 año</button>
  </div>
  <div class="outliers-grid" id="outliers-grid">
    ${outlierCards}
  </div>
</section>

<!-- ── MI CANAL ── -->
<section id="section-canal" class="section">
  <div class="section-header">
    <h2 class="section-title">📡 Mi Canal</h2>
  </div>

  <!-- Platform cards 2x2 -->
  <div class="canal-platforms-grid">

    <!-- YouTube (real data) -->
    <div class="platform-card">
      <div class="platform-card-header">
        <div class="platform-icon yt-icon">▶</div>
        <div>
          <div class="platform-name">YouTube</div>
          <div class="platform-handle">@marcia.nomada</div>
        </div>
        <div class="platform-live-badge">Live</div>
      </div>
      <div class="yt-loading" id="yt-loading"><div class="spinner"></div><span>Cargando...</span></div>
      <div id="yt-quick-stats" class="yt-quick-stats" style="display:none;">
        <div class="yt-qstat"><span class="yt-qstat-val" id="yt-subs">—</span><span class="yt-qstat-label">Suscriptores</span></div>
        <div class="yt-qstat"><span class="yt-qstat-val" id="yt-views-total">—</span><span class="yt-qstat-label">Vistas totales</span></div>
        <div class="yt-qstat"><span class="yt-qstat-val" id="yt-videos-count">—</span><span class="yt-qstat-label">Videos</span></div>
      </div>
    </div>

    <!-- Instagram -->
    <div class="platform-card" id="ig-card">
      <div class="platform-card-header">
        <div class="platform-icon ig-icon">📷</div>
        <div>
          <div class="platform-name">Instagram</div>
          <div class="platform-handle">@digital.marcia</div>
        </div>
        <div class="platform-live-badge" id="ig-live-badge" style="display:none;">Live</div>
      </div>
      <div id="ig-followers" class="platform-followers">1,730</div>
      <div id="ig-status" class="platform-status-msg">seguidores · Pendiente de conectar</div>
      <button class="btn-connect" id="ig-connect-btn" onclick="connectMeta()">Conectar con Meta</button>
    </div>

    <!-- Facebook -->
    <div class="platform-card" id="fb-card">
      <div class="platform-card-header">
        <div class="platform-icon fb-icon">f</div>
        <div>
          <div class="platform-name">Facebook</div>
          <div class="platform-handle">Digital.Marcia</div>
        </div>
        <div class="platform-live-badge" id="fb-live-badge" style="display:none;">Live</div>
      </div>
      <div id="fb-followers" class="platform-followers">1,500</div>
      <div id="fb-status" class="platform-status-msg">seguidores · Pendiente de conectar</div>
      <button class="btn-connect" id="fb-connect-btn" onclick="connectMeta()">Conectar con Meta</button>
    </div>

    <!-- TikTok -->
    <div class="platform-card">
      <div class="platform-card-header">
        <div class="platform-icon tt-icon">♪</div>
        <div>
          <div class="platform-name">TikTok</div>
          <div class="platform-handle">@marcia.nomada</div>
        </div>
        <div class="platform-live-badge" id="tt-live-badge" style="display:none;">Live</div>
      </div>
      <div id="tt-followers" class="platform-followers">241</div>
      <div id="tt-status" class="platform-status-msg">seguidores · Pendiente de conectar</div>
      <button class="btn-connect active" id="tt-connect-btn" onclick="window.location.href='/tiktok-auth'">Conectar</button>
    </div>

  </div>

  <!-- YPP Progress (shown after data loads) -->
  <div class="ypp-section" id="ypp-section" style="display:none;">
    <div class="ypp-title">🏆 Progreso hacia YouTube Partner Program</div>
    <div class="ypp-grid">
      <div>
        <div class="ypp-item-label">Suscriptores</div>
        <div class="ypp-item-vals"><span id="ypp-subs-val">—</span> / 1,000</div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" id="ypp-subs-bar" style="width:0%;background:#22c55e;"></div>
        </div>
        <div class="ypp-pct" id="ypp-subs-pct" style="color:#22c55e;"></div>
      </div>
      <div>
        <div class="ypp-item-label">Watch Time (4,000 hrs)</div>
        <div class="ypp-item-vals">Pendiente de calcular</div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:0%;background:#6b7280;"></div>
        </div>
        <div class="ypp-note">⚠️ Los Shorts no cuentan para las 4,000 horas</div>
      </div>
    </div>
  </div>

  <!-- YouTube expanded: top video + recent videos + avg -->
  <div id="yt-expanded-section" style="display:none;">

    <div class="yt-section-label">🏅 Video más visto</div>
    <div id="yt-top-card"></div>

    <div style="margin-top:24px;"></div>
    <div class="yt-section-label">🕐 Últimos 5 videos</div>
    <div class="yt-video-list" id="yt-video-list"></div>

    <div id="yt-avg-row" class="yt-avg-row" style="display:none;">
      <div>
        <div class="yt-avg-val" id="yt-avg-val">—</div>
        <div class="yt-avg-label">Promedio de vistas por video</div>
      </div>
    </div>

  </div>

</section>

<!-- ── REPURPOSER ── -->
<section id="section-repurposer" class="section">
  <div class="section-header">
    <h2 class="section-title">♻️ Repurposer</h2>
  </div>
  <p class="repurposer-desc">Convierte un guion o idea en 6 posts para Threads y X.</p>
  <textarea id="repurpose-input" class="repurposer-textarea" placeholder="Pega aquí el guion completo o el título del video que quieres convertir en posts..."></textarea>
  <br/>
  <button class="btn-repurpose" onclick="generatePosts()">⚡ Generar 6 posts</button>
  <div class="posts-loading" id="posts-loading">
    <div class="spinner" style="border-top-color:#22d3ee;"></div>
    <span>Generando posts con Claude...</span>
  </div>
  <div class="posts-grid" id="posts-grid"></div>
</section>

<!-- ── USO ── -->
<section id="section-uso" class="section">
  <div class="section-header">
    <h2 class="section-title">💰 Uso y Costos</h2>
    <a href="/usage" target="_blank" style="font-size:13px;color:#6366f1;text-decoration:none;">Ver página completa ↗</a>
  </div>
  <div id="uso-content"><p style="color:#6b7280;font-size:14px;">Cargando...</p></div>
</section>

</div>

<!-- ── CHANNEL MODAL ── -->
<div id="channel-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);z-index:200;align-items:center;justify-content:center;">
  <div class="channel-modal">
    <div class="ch-modal-header">
      <h2>⚙️ Gestionar canales</h2>
      <button class="ch-modal-close" onclick="closeChannelModal()">✕</button>
    </div>
    <div class="ch-modal-body">
      <div class="ch-search-row">
        <input id="ch-search-input" type="text" placeholder="@handle, nombre o URL del canal..."/>
        <button id="ch-search-btn" class="btn-search" onclick="searchChannel()">Buscar</button>
      </div>
      <div id="ch-preview" class="ch-preview">
        <div style="flex:1;">
          <div id="ch-preview-name" class="ch-preview-name"></div>
          <div id="ch-preview-id" class="ch-preview-id"></div>
        </div>
        <button class="btn-add-ch" onclick="addChannel()">+ Agregar</button>
      </div>
      <div class="ch-section-label">Canales actuales</div>
      <div id="ch-list" class="ch-list"></div>
      <div id="ch-msg" class="ch-msg"></div>
    </div>
    <div class="ch-modal-footer">
      <button class="btn-cancel-modal" onclick="closeChannelModal()">Cancelar</button>
      <button id="ch-save-btn" class="btn-save-channels" onclick="saveChannels()">💾 Guardar cambios</button>
    </div>
  </div>
</div>

<script>
  const videos = ${JSON.stringify(videos)};

  // ── Tab navigation ──────────────────────────────────────────────────────────
  function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('section-' + id).classList.add('active');
    document.querySelector('[data-section="' + id + '"]').classList.add('active');
    if (id === 'uso') loadUso();
    if (id === 'canal') loadCanal();
  }

  // ── Channel count ───────────────────────────────────────────────────────────
  fetch('/channels').then(r => r.json()).then(d => {
    const el = document.getElementById('metric-channels');
    if (el) el.textContent = (d.channels || []).length;
  }).catch(() => {});

  // ── Filters (topic + date, combined) ────────────────────────────────────────
  let _activeTopic = 'all';
  let _activeDays  = 0;

  function applyFilters() {
    const now = Date.now();
    document.querySelectorAll('.o-card').forEach(card => {
      const topic = card.dataset.category || '';
      const pub   = card.dataset.published;

      const topicOk = _activeTopic === 'all' || topic === _activeTopic;

      let dateOk = true;
      if (_activeDays > 0 && pub) {
        const age = (now - new Date(pub)) / 86400000;
        dateOk = age <= _activeDays;
      }

      card.style.display = topicOk && dateOk ? '' : 'none';
    });
  }

  function setTopic(topic, btn) {
    _activeTopic = topic;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
  }

  function setDate(days, btn) {
    _activeDays = days;
    document.querySelectorAll('.filter-date-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
  }

  // ── Card expansion + lazy pattern analysis ──────────────────────────────────
  function toggleCard(index) {
    const card = document.getElementById('o-card-' + index);
    const isExpanded = card.classList.contains('expanded');
    document.querySelectorAll('.o-card.expanded').forEach(c => { if (c !== card) c.classList.remove('expanded'); });
    if (isExpanded) { card.classList.remove('expanded'); return; }
    card.classList.add('expanded');
    const patternEl = document.getElementById('pattern-' + index);
    if (patternEl && patternEl.dataset.loaded !== 'true') loadPattern(index);
  }

  async function loadPattern(index) {
    const v = videos[index];
    const patternEl = document.getElementById('pattern-' + index);
    const loadingEl = document.getElementById('pattern-loading-' + index);
    patternEl.dataset.loaded = 'true';
    loadingEl.style.display = 'flex';
    try {
      const res = await fetch('/analyze-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: v.title, channel: v.channel, score: v.score }),
      });
      const data = await res.json();
      loadingEl.style.display = 'none';
      if (data.error) { patternEl.innerHTML = '<p style="color:#f87171;font-size:13px;">Error al analizar.</p>'; return; }
      patternEl.innerHTML = \`
        <div class="pattern-result">
          <div class="pattern-item">
            <div class="pattern-item-label">Patrón de título</div>
            <div class="pattern-item-value">\${data.titlePattern}</div>
          </div>
          <div class="pattern-item">
            <div class="pattern-item-label">Tipo de hook</div>
            <div class="pattern-item-value">\${data.hookType}</div>
          </div>
        </div>\`;
    } catch {
      loadingEl.style.display = 'none';
      patternEl.innerHTML = '<p style="color:#f87171;font-size:13px;">Error de red.</p>';
    }
  }

  // ── Format flow ──────────────────────────────────────────────────────────────
  function startGenerate(index, e) {
    e.stopPropagation();
    const sel = document.getElementById('format-sel-' + index);
    sel.style.display = sel.style.display === 'none' ? 'block' : 'none';
  }

  function selectFormat(index, format, e) {
    e.stopPropagation();
    document.getElementById('format-sel-' + index).style.display = 'none';
    if (format === 'long') generateScript(index);
    else document.getElementById('qty-sel-' + index).style.display = 'block';
  }

  // ── Long script ──────────────────────────────────────────────────────────────
  async function generateScript(index) {
    const v = videos[index];
    const btn = document.getElementById('gen-btn-' + index);
    const box = document.getElementById('script-' + index);
    const loading = document.getElementById('loading-' + index);
    const content = document.getElementById('content-' + index);
    const actions = document.getElementById('script-actions-' + index);
    btn.disabled = true; btn.textContent = '⏳ Generando...';
    box.style.display = 'block'; loading.style.display = 'flex';
    content.textContent = ''; actions.style.display = 'none';
    try {
      const res = await fetch('/generate-script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: v.title, channel: v.channel, score: v.score, url: v.url }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error'); }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      loading.style.display = 'none';
      let full = '', streamError = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) { streamError = json.error; break; }
            if (json.text) { full += json.text; content.textContent = full; content.scrollTop = content.scrollHeight; }
            if (json.done) { document.getElementById('header-cost').innerHTML = '💰 <strong>Actualizando...</strong> hoy'; setTimeout(() => location.reload(), 1500); }
          } catch {}
        }
        if (streamError) break;
      }
      if (streamError) throw new Error(streamError);
      if (!full) throw new Error('El modelo no devolvió contenido.');
      actions.style.display = 'flex'; btn.textContent = '✅ Generado';
      document.getElementById('repurpose-input').value = full;
    } catch (err) {
      loading.style.display = 'none'; btn.disabled = false; btn.textContent = '✨ Generar guion';
      content.textContent = '❌ Error: ' + err.message;
    }
  }

  function copyScript(index) {
    navigator.clipboard.writeText(document.getElementById('content-' + index).textContent).then(() => {
      const btn = document.querySelector('#script-actions-' + index + ' .btn-copy');
      btn.textContent = '✅ Copiado!';
      setTimeout(() => { btn.textContent = '📋 Copiar guion'; }, 2000);
    });
  }

  function openTeleprompter(index) {
    localStorage.setItem('teleprompter_script', document.getElementById('content-' + index).textContent);
    window.open('/teleprompter', '_blank');
  }

  // ── Shorts ──────────────────────────────────────────────────────────────────
  async function generateShorts(index, qty, e) {
    if (e) e.stopPropagation();
    const v = videos[index];
    document.getElementById('qty-sel-' + index).style.display = 'none';
    const box = document.getElementById('shorts-' + index);
    const loading = document.getElementById('shorts-loading-' + index);
    const contentEl = document.getElementById('shorts-content-' + index);
    box.style.display = 'block'; loading.style.display = 'flex'; contentEl.innerHTML = '';
    try {
      const res = await fetch('/generate-shorts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: v.title, channel: v.channel, score: v.score, url: v.url, quantity: qty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      loading.style.display = 'none';
      contentEl.innerHTML = data.shorts.map((s, i) => \`
        <div class="short-card">
          <div class="short-card-header">
            <span class="short-num">SHORT \${i + 1}</span>
            <span class="short-filming">\${s.filming}</span>
          </div>
          <div class="short-section"><div class="short-section-label">Hook</div><div class="short-text">\${s.hook}</div></div>
          <div class="short-section"><div class="short-section-label">Desarrollo</div><div class="short-text">\${s.body}</div></div>
          <div class="short-section"><div class="short-section-label">CTA</div><div class="short-text">\${s.cta}</div></div>
          <button class="short-copy-btn" onclick="copyShort(this, \\\`\${s.hook}\\\\n\\\\n\${s.body}\\\\n\\\\n\${s.cta}\\\`)">📋 Copiar short \${i + 1}</button>
        </div>\`).join('');
    } catch (err) {
      loading.style.display = 'none';
      contentEl.innerHTML = \`<p style="color:#ef4444;padding:12px;">❌ \${err.message}</p>\`;
    }
  }

  function copyShort(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅ Copiado';
      setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2000);
    });
  }

  // ── Repurposer ──────────────────────────────────────────────────────────────
  const POST_LABELS = ['El dato sorprendente','La historia personal','La reflexión sobre trabajar online','El contraste nómada vs corporativo','El consejo práctico','La pregunta que genera debate'];

  async function generatePosts() {
    const input = document.getElementById('repurpose-input').value.trim();
    if (!input) { alert('Pega el guion o título primero.'); return; }
    const btn = document.querySelector('.btn-repurpose');
    const loading = document.getElementById('posts-loading');
    const grid = document.getElementById('posts-grid');
    btn.disabled = true; btn.textContent = '⏳ Generando...';
    loading.style.display = 'flex'; grid.innerHTML = '';
    try {
      const res = await fetch('/generate-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      loading.style.display = 'none';
      grid.innerHTML = data.posts.map((post, i) => \`
        <div class="post-card">
          <div class="post-card-label">\${POST_LABELS[i] || 'Post ' + (i+1)}</div>
          <div class="post-versions">
            <div class="post-version">
              <div class="post-platform threads">Threads</div>
              <div class="post-text" id="pt-\${i}">\${post.threads}</div>
              <div class="post-chars">\${post.threads.length} / 500 chars</div>
              <button class="btn-copy-post" onclick="copyPost('pt-\${i}',this)">Copiar</button>
            </div>
            <div class="post-version">
              <div class="post-platform x">X / Twitter</div>
              <div class="post-text" id="px-\${i}">\${post.x}</div>
              <div class="post-chars">\${post.x.length} / 280 chars</div>
              <button class="btn-copy-post" onclick="copyPost('px-\${i}',this)">Copiar</button>
            </div>
          </div>
        </div>\`).join('');
    } catch (err) {
      loading.style.display = 'none';
      grid.innerHTML = \`<p style="color:#ef4444;">❌ \${err.message}</p>\`;
    } finally {
      btn.disabled = false; btn.textContent = '⚡ Generar 6 posts';
    }
  }

  function copyPost(id, btn) {
    navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => {
      btn.textContent = '✅ Copiado';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
  }

  // ── USO (lazy) ──────────────────────────────────────────────────────────────
  let usoLoaded = false;
  async function loadUso() {
    if (usoLoaded) return;
    usoLoaded = true;
    try {
      const [sr, hr] = await Promise.all([fetch('/usage-summary'), fetch('/usage-data')]);
      const summary = await sr.json();
      const hist = await hr.json();
      const dailyRows = (hist.dailyTotals || []).map(d =>
        \`<tr><td>\${d.date}</td><td style="color:#a78bfa;font-weight:700;">$\${d.cost.toFixed(4)}</td></tr>\`
      ).join('');
      const histRows = (hist.history || []).slice(0, 30).map(h => {
        const tc = h.type === 'guion' ? 'type-guion' : h.type === 'short' ? 'type-short' : 'type-posts';
        return \`<tr>
          <td>\${(h.date||'').slice(0,10)}</td>
          <td><span class="type-badge-uso \${tc}">\${h.type}</span></td>
          <td>\${(h.input_tokens||0).toLocaleString()}</td>
          <td>\${(h.output_tokens||0).toLocaleString()}</td>
          <td style="color:#a78bfa;font-weight:700;">$\${(h.cost_usd||0).toFixed(4)}</td>
        </tr>\`;
      }).join('');
      document.getElementById('uso-content').innerHTML = \`
        <div class="uso-grid">
          <div class="uso-card"><div class="uso-card-label">Costo hoy</div><div class="uso-card-value">$\${(summary.today||0).toFixed(4)}</div></div>
          <div class="uso-card"><div class="uso-card-label">Total acumulado</div><div class="uso-card-value">$\${(summary.total||0).toFixed(4)}</div></div>
        </div>
        <div class="uso-section-label">Últimos 7 días</div>
        <table class="uso-table" style="margin-bottom:28px;"><thead><tr><th>Fecha</th><th>Costo</th></tr></thead>
        <tbody>\${dailyRows||'<tr><td colspan="2" style="color:#4b5563;padding:12px;">Sin datos</td></tr>'}</tbody></table>
        <div class="uso-section-label">Historial reciente</div>
        <table class="uso-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Tokens entrada</th><th>Tokens salida</th><th>Costo</th></tr></thead>
        <tbody>\${histRows||'<tr><td colspan="5" style="color:#4b5563;padding:12px;">Sin datos</td></tr>'}</tbody></table>\`;
    } catch { document.getElementById('uso-content').innerHTML = '<p style="color:#f87171;">Error al cargar datos.</p>'; }
  }

  // ── Channel manager ─────────────────────────────────────────────────────────
  let channelList = [];

  async function openChannelModal() {
    document.getElementById('channel-modal-overlay').style.display = 'flex';
    document.getElementById('ch-search-input').value = '';
    document.getElementById('ch-preview').style.display = 'none';
    document.getElementById('ch-msg').textContent = '';
    await loadCurrentChannels();
  }
  function closeChannelModal() { document.getElementById('channel-modal-overlay').style.display = 'none'; }

  async function loadCurrentChannels() {
    try {
      const res = await fetch('/channels');
      channelList = (await res.json()).channels || [];
      renderChannelList();
    } catch { document.getElementById('ch-msg').textContent = 'Error al cargar canales.'; }
  }

  function renderChannelList() {
    const el = document.getElementById('ch-list');
    if (!channelList.length) { el.innerHTML = '<p style="color:#4b5563;font-size:13px;padding:8px 0;">No hay canales guardados.</p>'; return; }
    el.innerHTML = channelList.map((c, i) => \`
      <div class="ch-item">
        <span class="ch-item-name">\${c.name || c.channelId || c.id}</span>
        <span class="ch-item-id">\${c.channelId || c.id || ''}</span>
        <button class="ch-remove-btn" onclick="removeChannel(\${i})">✕</button>
      </div>\`).join('');
  }

  async function searchChannel() {
    const query = document.getElementById('ch-search-input').value.trim();
    if (!query) return;
    const btn = document.getElementById('ch-search-btn');
    btn.textContent = 'Buscando...'; btn.disabled = true;
    document.getElementById('ch-preview').style.display = 'none';
    document.getElementById('ch-msg').textContent = '';
    try {
      const res = await fetch('/channels/search?q=' + encodeURIComponent(query));
      const data = await res.json();
      if (data.error) {
        document.getElementById('ch-msg').textContent = data.error;
        document.getElementById('ch-msg').style.color = '#ef4444';
      } else {
        document.getElementById('ch-preview-name').textContent = data.name;
        document.getElementById('ch-preview-id').textContent = data.channelId;
        const preview = document.getElementById('ch-preview');
        preview.style.display = 'flex';
        preview.dataset.channelId = data.channelId;
        preview.dataset.channelName = data.name;
      }
    } catch { document.getElementById('ch-msg').textContent = 'Error al buscar canal.'; }
    btn.textContent = 'Buscar'; btn.disabled = false;
  }

  function addChannel() {
    const preview = document.getElementById('ch-preview');
    const channelId = preview.dataset.channelId;
    const name = preview.dataset.channelName;
    if (!channelId) return;
    if (channelList.some(c => (c.channelId || c.id) === channelId)) {
      document.getElementById('ch-msg').textContent = 'Este canal ya está en la lista.';
      document.getElementById('ch-msg').style.color = '#f97316';
      return;
    }
    channelList.push({ name, channelId });
    renderChannelList();
    preview.style.display = 'none';
    document.getElementById('ch-search-input').value = '';
    document.getElementById('ch-msg').textContent = '';
  }

  function removeChannel(i) { channelList.splice(i, 1); renderChannelList(); }

  async function saveChannels() {
    const btn = document.getElementById('ch-save-btn');
    btn.textContent = 'Guardando...'; btn.disabled = true;
    document.getElementById('ch-msg').textContent = '';
    try {
      const res = await fetch('/channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: channelList }),
      });
      const data = await res.json();
      if (data.ok) { document.getElementById('ch-msg').textContent = '✅ Canales guardados.'; document.getElementById('ch-msg').style.color = '#4ade80'; }
      else { document.getElementById('ch-msg').textContent = data.error || 'Error al guardar.'; document.getElementById('ch-msg').style.color = '#ef4444'; }
    } catch { document.getElementById('ch-msg').textContent = 'Error de red.'; document.getElementById('ch-msg').style.color = '#ef4444'; }
    btn.textContent = '💾 Guardar cambios'; btn.disabled = false;
  }

  document.getElementById('ch-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchChannel(); });
  document.getElementById('channel-modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeChannelModal(); });

  // ── Mi Canal ─────────────────────────────────────────────────────────────────
  let canalLoaded = false;
  async function loadCanal() {
    if (canalLoaded) return;
    canalLoaded = true;
    const loadingEl = document.getElementById('yt-loading');
    try {
      const res = await fetch('/my-channel');
      const data = await res.json();
      if (data.error) {
        loadingEl.innerHTML = \`<span style="color:#ef4444;">Error: \${data.error}</span>\`;
        return;
      }

      // Quick stats
      document.getElementById('yt-subs').textContent = fmtNum(data.subscribers);
      document.getElementById('yt-views-total').textContent = fmtNum(data.totalViews);
      document.getElementById('yt-videos-count').textContent = fmtNum(data.videoCount);
      loadingEl.style.display = 'none';
      document.getElementById('yt-quick-stats').style.display = 'flex';

      // YPP subs progress
      const subsPct = Math.min(100, Math.round((data.subscribers / 1000) * 100));
      document.getElementById('ypp-subs-val').textContent = data.subscribers.toLocaleString('es-CL');
      document.getElementById('ypp-subs-bar').style.width = subsPct + '%';
      document.getElementById('ypp-subs-bar').style.background = subsPct >= 100 ? '#22c55e' : subsPct >= 50 ? '#eab308' : '#f97316';
      document.getElementById('ypp-subs-pct').textContent = subsPct + '% completado';
      document.getElementById('ypp-section').style.display = 'block';

      // Top video
      if (data.topVideo) {
        const tv = data.topVideo;
        document.getElementById('yt-top-card').innerHTML = \`
          <div class="yt-top-card">
            \${tv.thumbnail ? \`<img class="yt-top-thumb" src="\${tv.thumbnail}" alt=""/>\` : \`<div class="yt-top-thumb"></div>\`}
            <div class="yt-top-body">
              <div class="yt-top-badge">🏅 Más visto del canal</div>
              <div class="yt-top-title">\${tv.title}</div>
              <div class="yt-top-meta">👁 \${fmtNum(tv.views)} vistas · 👍 \${fmtNum(tv.likes)} likes · \${fmtDate(tv.publishedAt)}</div>
              <a class="btn-yt" href="\${tv.url}" target="_blank" style="margin-top:8px;width:fit-content;">▶ Ver video</a>
            </div>
          </div>\`;
      }

      // Recent videos
      const listEl = document.getElementById('yt-video-list');
      if (data.recentVideos && data.recentVideos.length > 0) {
        listEl.innerHTML = data.recentVideos.map((v, i) => \`
          <div class="yt-video-item">
            <div class="yt-video-rank">\${i + 1}</div>
            \${v.thumbnail ? \`<img class="yt-video-thumb" src="\${v.thumbnail}" alt=""/>\` : \`<div class="yt-video-thumb-placeholder">▶</div>\`}
            <div class="yt-video-body">
              <div class="yt-video-title">\${v.title}</div>
              <div class="yt-video-meta">
                <span>👁 \${fmtNum(v.views)}</span>
                <span>👍 \${fmtNum(v.likes)}</span>
                <span>\${fmtDate(v.publishedAt)}</span>
              </div>
            </div>
            <a class="btn-yt" href="\${v.url}" target="_blank" style="flex-shrink:0;">▶</a>
          </div>\`).join('');
      }

      // Avg views
      if (data.avgViews) {
        document.getElementById('yt-avg-val').textContent = fmtNum(data.avgViews);
        document.getElementById('yt-avg-row').style.display = 'flex';
      }

      document.getElementById('yt-expanded-section').style.display = 'block';

      // TikTok: update card if connected
      if (data.tiktokConnected) {
        document.getElementById('tt-live-badge').style.display = '';
        const ttBtn = document.getElementById('tt-connect-btn');
        ttBtn.textContent = '✓ Conectado';
        ttBtn.disabled = true;
        ttBtn.classList.remove('active');
        if (data.tiktokFollowers !== null) {
          document.getElementById('tt-followers').textContent = fmtNum(data.tiktokFollowers);
          document.getElementById('tt-status').textContent = 'seguidores reales';
        }
      }

      // Meta: update IG + FB cards if connected
      if (data.metaConnected) {
        ['ig', 'fb'].forEach(p => {
          document.getElementById(p + '-live-badge').style.display = '';
          document.getElementById(p + '-connect-btn').textContent = '✓ Conectado';
          document.getElementById(p + '-connect-btn').disabled = true;
        });
        if (data.instagramFollowers !== null) {
          document.getElementById('ig-followers').textContent = fmtNum(data.instagramFollowers);
          document.getElementById('ig-status').textContent = 'seguidores reales';
        }
        if (data.facebookFollowers !== null) {
          document.getElementById('fb-followers').textContent = fmtNum(data.facebookFollowers);
          document.getElementById('fb-status').textContent = 'seguidores reales';
        }
      } else {
        // Fetch config to get Meta App ID
        try {
          const cfgRes = await fetch('/config');
          const cfg = await cfgRes.json();
          if (cfg.metaAppId) {
            window._metaAppId = cfg.metaAppId;
            ['ig-connect-btn', 'fb-connect-btn'].forEach(id => {
              const btn = document.getElementById(id);
              btn.disabled = false;
              btn.classList.add('active');
            });
          } else {
            document.getElementById('ig-status').textContent = 'seguidores \xB7 Configurar META_APP_ID para conectar';
            document.getElementById('fb-status').textContent = 'seguidores \xB7 Configurar META_APP_ID para conectar';
          }
        } catch (_) {}
      }
    } catch (err) {
      loadingEl.innerHTML = \`<span style="color:#ef4444;">Error al cargar datos del canal.</span>\`;
    }
  }

  function connectMeta() {
    const appId = window._metaAppId;
    if (!appId) return;
    const redirectUri = encodeURIComponent('https://outlier-finder-production-4085.up.railway.app/meta-callback');
    const scope = encodeURIComponent('pages_show_list,pages_read_engagement');
    window.location.href = \`https://www.facebook.com/dialog/oauth?client_id=\${appId}&redirect_uri=\${redirectUri}&scope=\${scope}&response_type=token\`;
  }

  function fmtNum(n) {
    if (!n && n !== 0) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString('es-CL');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
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
    if (fromRedis) return res.json({ channels: fromRedis });
    const fromFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'channels.json'), 'utf-8'));
    res.json({ channels: fromFile });
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

// ── GET /my-channel ───────────────────────────────────────────────────────────
app.get('/my-channel', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'YOUTUBE_API_KEY no configurada.' });

  try {
    // 1. Resolve @marcia.nomada handle → channelId + basic stats
    const chRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'id,snippet,statistics', forHandle: 'marcia.nomada', key: apiKey },
    });
    const channel = chRes.data.items && chRes.data.items[0];
    if (!channel) return res.status(404).json({ error: 'Canal @marcia.nomada no encontrado.' });

    const channelId = channel.id;
    const stats = channel.statistics;
    const subscribers = parseInt(stats.subscriberCount || 0, 10);
    const totalViews = parseInt(stats.viewCount || 0, 10);
    const videoCount = parseInt(stats.videoCount || 0, 10);
    const avgViews = videoCount > 0 ? Math.round(totalViews / videoCount) : 0;

    // 2. Fetch the 5 most recent videos (IDs)
    const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', channelId, order: 'date', maxResults: 5, type: 'video', key: apiKey },
    });
    const searchItems = searchRes.data.items || [];
    const recentIds = searchItems.map(i => i.id.videoId).join(',');

    // 3. Fetch video stats for recent videos
    let recentVideos = [];
    if (recentIds) {
      const vRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet,statistics', id: recentIds, key: apiKey },
      });
      recentVideos = (vRes.data.items || []).map(v => ({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
        views: parseInt(v.statistics.viewCount || 0, 10),
        likes: parseInt(v.statistics.likeCount || 0, 10),
        url: `https://www.youtube.com/watch?v=${v.id}`,
      }));
    }

    // 4. Fetch top video by views (search by viewCount order)
    const topRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', channelId, order: 'viewCount', maxResults: 1, type: 'video', key: apiKey },
    });
    const topItem = topRes.data.items && topRes.data.items[0];
    let topVideo = null;
    if (topItem) {
      const topVRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet,statistics', id: topItem.id.videoId, key: apiKey },
      });
      const tv = topVRes.data.items && topVRes.data.items[0];
      if (tv) {
        topVideo = {
          id: tv.id,
          title: tv.snippet.title,
          publishedAt: tv.snippet.publishedAt,
          thumbnail: tv.snippet.thumbnails?.medium?.url || tv.snippet.thumbnails?.default?.url || '',
          views: parseInt(tv.statistics.viewCount || 0, 10),
          likes: parseInt(tv.statistics.likeCount || 0, 10),
          url: `https://www.youtube.com/watch?v=${tv.id}`,
        };
      }
    }

    // 5. Meta (Facebook + Instagram) — only if token is stored
    let metaConnected = false;
    let facebookFollowers = null;
    let instagramFollowers = null;

    const metaToken = await loadMetaToken();
    if (metaToken) {
      metaConnected = true;
      try {
        const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
          params: { access_token: metaToken, fields: 'id,name,access_token,followers_count,fan_count' },
        });
        const pages = pagesRes.data.data || [];
        const page = pages.find(p => /marcia/i.test(p.name)) || pages[0];
        if (page) {
          const pageToken = page.access_token || metaToken;
          const pageRes = await axios.get(`https://graph.facebook.com/v19.0/${page.id}`, {
            params: { fields: 'followers_count,fan_count,instagram_business_account', access_token: pageToken },
          });
          facebookFollowers = pageRes.data.followers_count ?? pageRes.data.fan_count ?? null;
          const igId = pageRes.data.instagram_business_account?.id;
          if (igId) {
            const igRes = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
              params: { fields: 'followers_count,username', access_token: pageToken },
            });
            instagramFollowers = igRes.data.followers_count ?? null;
          }
        }
      } catch (metaErr) {
        const detail = metaErr.response?.data?.error?.message || metaErr.message;
        console.error('Meta API error:', detail);
        // If token is expired/invalid, treat as not connected so the button re-enables
        const code = metaErr.response?.data?.error?.code;
        if (code === 190 || /expired|invalid/i.test(detail)) {
          metaConnected = false;
        }
      }
    }

    // 6. TikTok — only if token is stored
    let tiktokFollowers = null;
    let tiktokConnected = false;
    const ttToken = await loadTikTokToken();
    if (ttToken) {
      tiktokConnected = true;
      try {
        const ttRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
          params: { fields: 'follower_count,like_count,video_count' },
          headers: { Authorization: `Bearer ${ttToken}` },
        });
        tiktokFollowers = ttRes.data.data?.user?.follower_count ?? null;
      } catch (ttErr) {
        console.error('TikTok API error:', ttErr.response?.data?.error?.message || ttErr.message);
      }
    }

    res.json({ subscribers, totalViews, videoCount, avgViews, recentVideos, topVideo, metaConnected, facebookFollowers, instagramFollowers, tiktokConnected, tiktokFollowers });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ── GET /terms ────────────────────────────────────────────────────────────────
app.get('/terms', (req, res) => {
  res.type('text/html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Terms of Service</title><style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 24px;color:#111;line-height:1.6}h1{font-size:22px}</style></head><body><h1>Digital Marcia Content Studio — Terms of Service</h1><p>This app is for personal use only by the account owner.</p></body></html>`);
});

// ── GET /privacy ──────────────────────────────────────────────────────────────
app.get('/privacy', (req, res) => {
  res.type('text/html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Privacy Policy</title><style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 24px;color:#111;line-height:1.6}h1{font-size:22px}</style></head><body><h1>Digital Marcia Content Studio — Privacy Policy</h1><p>This app collects no user data. It is used solely by the account owner to view their own social media metrics.</p></body></html>`);
});

// ── GET /tiktok-auth ──────────────────────────────────────────────────────────
app.get('/tiktok-auth', (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) return res.status(500).send('TIKTOK_CLIENT_KEY no configurada.');
  const redirectUri = encodeURIComponent('https://outlier-finder-production-4085.up.railway.app/tiktok-callback');
  const scope = encodeURIComponent('user.info.basic');
  res.redirect(`https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${redirectUri}&state=random123`);
});

// ── GET /tiktok-callback ──────────────────────────────────────────────────────
app.get('/tiktok-callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.status(400).send(`Error de TikTok: ${error_description || error}`);
  if (!code) return res.status(400).send(`No se recibió el código de autorización.<br><br>Parámetros recibidos: <pre>${JSON.stringify(req.query, null, 2)}</pre>`);

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return res.status(500).send('Credenciales de TikTok no configuradas.');

  try {
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: 'https://outlier-finder-production-4085.up.railway.app/tiktok-callback',
    });
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error(JSON.stringify(tokenRes.data));
    await saveTikTokToken(accessToken);
    res.redirect('/?tiktok=connected');
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    res.status(500).send(`Error al obtener token de TikTok: ${msg}`);
  }
});

// ── GET /tiktok-data ──────────────────────────────────────────────────────────
app.get('/tiktok-data', async (req, res) => {
  const token = await loadTikTokToken();
  if (!token) return res.status(404).json({ error: 'No hay token de TikTok guardado.' });
  try {
    const ttRes = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: { fields: 'follower_count,like_count,video_count' },
      headers: { Authorization: `Bearer ${token}` },
    });
    res.json(ttRes.data.data?.user || {});
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ── TikTok domain verification ────────────────────────────────────────────────
app.get('/tiktokKJmA2tsjPNtAzupoJPtB75Mxs9UGG5kg.txt', (req, res) => {
  res.type('text/plain').send('tiktok-developers-site-verification=KJmA2tsjPNtAzupoJPtB75Mxs9UGG5kg');
});

// ── GET /meta-disconnect ──────────────────────────────────────────────────────
app.get('/meta-disconnect', async (req, res) => {
  await saveMetaToken('');
  res.redirect('/?meta=disconnected');
});

// ── GET /meta-debug ───────────────────────────────────────────────────────────
app.get('/meta-debug', async (req, res) => {
  const token = await loadMetaToken();
  if (!token) return res.json({ error: 'No hay token guardado en Redis.' });
  try {
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: token, fields: 'id,name,access_token,followers_count,fan_count' },
    });
    const pages = pagesRes.data.data || [];
    const results = await Promise.all(pages.map(async p => {
      const pt = p.access_token || token;
      const detail = await axios.get(`https://graph.facebook.com/v19.0/${p.id}`, {
        params: { fields: 'followers_count,fan_count,instagram_business_account', access_token: pt },
      }).then(r => r.data).catch(e => ({ error: e.response?.data?.error?.message || e.message }));
      let ig = null;
      if (detail.instagram_business_account?.id) {
        ig = await axios.get(`https://graph.facebook.com/v19.0/${detail.instagram_business_account.id}`, {
          params: { fields: 'followers_count,username', access_token: pt },
        }).then(r => r.data).catch(e => ({ error: e.response?.data?.error?.message || e.message }));
      }
      return { page_id: p.id, page_name: p.name, ...detail, instagram: ig };
    }));
    res.json({ token_preview: token.slice(0, 20) + '...', pages: results });
  } catch (err) {
    res.json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ── GET /config ───────────────────────────────────────────────────────────────
app.get('/config', (req, res) => {
  res.json({ metaAppId: process.env.META_APP_ID || null });
});

// ── GET /meta-callback ────────────────────────────────────────────────────────
app.get('/meta-callback', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Conectando Meta…</title>
  <style>
    body { background: #0f0f0f; color: #e5e7eb; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; flex-direction: column; gap: 16px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 32px 40px; text-align: center; max-width: 420px; }
    h2 { margin: 0 0 8px; font-size: 20px; }
    p  { margin: 0; color: #9ca3af; font-size: 14px; }
    .spinner { width: 36px; height: 36px; border: 3px solid #2a2a2a; border-top-color: #6366f1; border-radius: 50%; animation: spin .8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .success { color: #4ade80; font-size: 32px; }
    .err { color: #f87171; }
    a { color: #818cf8; text-decoration: none; font-size: 14px; margin-top: 16px; display: inline-block; }
  </style>
</head>
<body>
  <div class="card" id="box">
    <div class="spinner" id="spinner"></div>
    <h2 id="title">Conectando con Meta…</h2>
    <p id="msg">Guardando token de acceso…</p>
  </div>
  <script>
    (async () => {
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const token = params.get('access_token');

      if (!token) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('title').textContent = '❌ Error';
        document.getElementById('msg').textContent = 'No se encontró el token de acceso en la URL.';
        return;
      }

      try {
        const res = await fetch('/meta-callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: token }),
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('spinner').style.display = 'none';
          document.getElementById('title').innerHTML = '<span class="success">✅</span> Conectado exitosamente';
          document.getElementById('msg').textContent = 'Token de Meta guardado. Puedes cerrar esta ventana.';
          setTimeout(() => { window.location.href = '/'; }, 2500);
        } else {
          throw new Error(data.error || 'Error desconocido');
        }
      } catch (err) {
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('title').textContent = '❌ Error';
        document.getElementById('msg').innerHTML = '<span class="err">' + err.message + '</span>';
      }
    })();
  </script>
</body>
</html>`);
});

// ── POST /meta-callback ───────────────────────────────────────────────────────
app.post('/meta-callback', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Falta access_token.' });
  try {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    let tokenToSave = access_token;

    // Exchange short-lived token (~1h) for long-lived token (~60 days)
    if (appId && appSecret) {
      const exchangeRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: access_token,
        },
      });
      tokenToSave = exchangeRes.data.access_token || access_token;
    }

    await saveMetaToken(tokenToSave);
    res.json({ success: true });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: detail });
  }
});

// ── POST /analyze-pattern ─────────────────────────────────────────────────────
app.post('/analyze-pattern', async (req, res) => {
  const { videoTitle, channel, score } = req.body;
  if (!videoTitle) return res.status(400).json({ error: 'Falta videoTitle.' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Analiza brevemente este título de video que fue ${score}x el promedio del canal "${channel}": "${videoTitle}"\n\nResponde ÚNICAMENTE con JSON válido:\n{"titlePattern": "descripción del patrón de título en 1-2 oraciones", "hookType": "tipo de hook: Curiosity Gap | VS Comparison | Number List | Controversy | How-To | Personal Story | Shocking Stat — con una breve explicación de por qué funciona en este caso"}` }],
    });
    const raw = message.content[0].text.trim();
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /usage-data ───────────────────────────────────────────────────────────
app.get('/usage-data', async (req, res) => {
  const [history, dailyTotals] = await Promise.all([
    getUsageHistory(50),
    getDailyTotals(7),
  ]);
  res.json({ history, dailyTotals });
});

function startServer() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Servidor web en http://localhost:${port}`);
  });
}

module.exports = { startServer };
