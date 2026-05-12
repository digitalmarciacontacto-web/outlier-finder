require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const OUTLIERS_FILE = path.join(__dirname, 'outliers.json');

function readOutliers() {
  if (!fs.existsSync(OUTLIERS_FILE)) return { date: null, videos: [] };
  try {
    return JSON.parse(fs.readFileSync(OUTLIERS_FILE, 'utf-8'));
  } catch {
    return { date: null, videos: [] };
  }
}

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const { date, videos } = readOutliers();

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
          <button class="btn-copy" id="copy-${i}" onclick="copyScript(${i})" style="display:none;">📋 Copiar guion</button>
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

    header p {
      font-size: 13px;
      color: #64748b;
      margin-top: 2px;
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

    .empty {
      text-align: center;
      padding: 80px 20px;
      color: #4b5563;
    }
    .empty code {
      background: #1e293b;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 14px;
      color: #94a3b8;
    }

    .card {
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #312e81; }

    .card-top {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
    }

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
      width: 20px;
      height: 20px;
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

    .btn-copy {
      margin-top: 12px;
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
    <p>Videos outlier detectados · Generador de guiones con IA</p>
  </div>
</header>

<div class="date-bar">
  Último análisis: <span>${date || 'Sin datos aún'}</span>
  &nbsp;·&nbsp; ${videos.length} outliers encontrados
</div>

<main>${cards}</main>

<script>
  const videos = ${JSON.stringify(videos)};

  async function generateScript(index) {
    const v = videos[index];
    const btn = document.querySelector(\`[data-index="\${index}"] .btn-gen\`);
    const box = document.getElementById(\`script-\${index}\`);
    const loading = document.getElementById(\`loading-\${index}\`);
    const content = document.getElementById(\`content-\${index}\`);
    const copyBtn = document.getElementById(\`copy-\${index}\`);

    btn.disabled = true;
    btn.textContent = '⏳ Generando...';
    box.style.display = 'block';
    loading.style.display = 'flex';
    content.textContent = '';
    copyBtn.style.display = 'none';

    try {
      const res = await fetch('/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoTitle: v.title,
          channel: v.channel,
          score: v.score,
          url: v.url,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al generar guion');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      loading.style.display = 'none';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.text) {
                full += json.text;
                content.textContent = full;
                content.scrollTop = content.scrollHeight;
              }
            } catch {}
          }
        }
      }

      copyBtn.style.display = 'inline-block';
      btn.textContent = '✅ Guion generado';
    } catch (err) {
      loading.style.display = 'none';
      content.textContent = '❌ Error: ' + err.message;
    }
  }

  function copyScript(index) {
    const content = document.getElementById(\`content-\${index}\`);
    navigator.clipboard.writeText(content.textContent).then(() => {
      const btn = document.getElementById(\`copy-\${index}\`);
      btn.textContent = '✅ Copiado!';
      setTimeout(() => { btn.textContent = '📋 Copiar guion'; }, 2000);
    });
  }
</script>

</body>
</html>`;

  res.send(html);
});

// ── POST /generate-script ──────────────────────────────────────────────────────
app.post('/generate-script', async (req, res) => {
  const { videoTitle, channel, score, url } = req.body;

  if (!videoTitle || !channel) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada.' });
  }

  const prompt = `CONTEXTO DE MARCA:
Soy Marcia, chilena, Ingeniera Comercial, nómada digital.
Mi nicho: vida nómada real sin romantizar — costos reales, choques culturales, lo que nadie te cuenta. Mi voz: honesta, directa, conversacional, en primera persona, como con una amiga. Sin frases motivacionales vacías. Siempre anclado a experiencia real.
He vivido en Dinamarca, Inglaterra, Lituania, Croacia, Francia, Grecia y Egipto. Próximo destino: Jordania o Marruecos.

VIDEO OUTLIER A ADAPTAR:
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
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta?.type === 'text_delta'
      ) {
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

function startServer() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🌐 Servidor web en http://localhost:${port}`);
  });
}

module.exports = { startServer };
