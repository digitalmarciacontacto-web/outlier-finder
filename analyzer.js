require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { analyzeChannel } = require('./youtube');
const { sendOutlierEmail } = require('./email');
const { saveOutliersToRedis, loadChannels } = require('./redis');

const OUTLIER_THRESHOLD = 200;

const VALID_CATEGORIES = ['destino', 'finanzas', 'reinvención', 'trabajo-remoto', 'lado-b', 'logistica'];

async function classifyOutliers(outliers, anthropicKey) {
  if (!anthropicKey || outliers.length === 0) return;
  const client = new Anthropic({ apiKey: anthropicKey });
  const videoList = outliers.map((v, i) =>
    `${i + 1}. Título: "${v.title}" | Descripción: "${v.description || ''}"`
  ).join('\n');
  const prompt = `Clasifica cada video en UNA de estas categorías exactas:
- destino (videos sobre vivir/viajar a un lugar específico)
- finanzas (costos, ingresos, presupuesto, dinero)
- reinvención (dejar trabajo, cambiar de vida, libertad)
- trabajo-remoto (herramientas, clientes, freelance)
- lado-b (lo que nadie te cuenta, errores, realidad sin filtro)
- logistica (visas, alojamiento, transporte, mudanza)

Videos:
${videoList}

Responde ÚNICAMENTE con un array JSON con la categoría de cada video en el mismo orden.
Ejemplo: ["destino", "finanzas", "lado-b"]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: Math.max(50, outliers.length * 20),
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('Respuesta de clasificación inválida');
  const categories = JSON.parse(match[0]);
  outliers.forEach((v, i) => {
    v.category = VALID_CATEGORIES.includes(categories[i]) ? categories[i] : 'lado-b';
  });
}
const OUTLIERS_FILE = path.join(__dirname, 'outliers.json');
const CHANNELS_FILE = path.join(__dirname, 'channels.json');

async function getChannels() {
  try {
    const fromRedis = await loadChannels();
    if (fromRedis && fromRedis.length > 0) return fromRedis;
  } catch {}
  return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf-8'));
}

function buildPayload(outliers) {
  return {
    date: new Date().toISOString().split('T')[0],
    videos: outliers.map(v => ({
      title: v.title,
      channel: v.channelName,
      score: v.score,
      views: v.views,
      channelAvg: v.averageViews,
      url: v.url,
      thumbnail: v.thumbnail || '',
      publishedAt: v.publishedAt || '',
      category: v.category || '',
    })),
  };
}

async function runAnalysis() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.EMAIL_TO;
  const emailFrom = process.env.EMAIL_FROM || 'outlier-finder@resend.dev';

  if (!apiKey || !resendKey || !emailTo) {
    throw new Error('Faltan variables de entorno: YOUTUBE_API_KEY, RESEND_API_KEY, EMAIL_TO');
  }

  const channels = await getChannels();
  if (!channels || channels.length === 0) {
    throw new Error('channels.json está vacío. Agrega al menos un canal.');
  }

  console.log(`\n📊 Analizando ${channels.length} canal(es)...\n`);

  const allOutliers = [];

  for (const channel of channels) {
    try {
      console.log(`  ↳ ${channel.name || channel.id}...`);
      const id = channel.id || channel.channelId;
      const videos = await analyzeChannel(apiKey, id, channel.name || id);
      const outliers = videos.filter(v => v.score >= OUTLIER_THRESHOLD);
      console.log(`    ${videos.length} videos analizados · ${outliers.length} outliers (score ≥ ${OUTLIER_THRESHOLD})`);
      allOutliers.push(...outliers);
    } catch (err) {
      console.error(`    ❌ Error en canal ${channel.id || channel.channelId}: ${err.message}`);
    }
  }

  allOutliers.sort((a, b) => b.score - a.score);
  console.log(`\n🎯 Total outliers encontrados: ${allOutliers.length}`);

  if (allOutliers.length > 0) {
    try {
      console.log('🏷️  Clasificando outliers con Claude...');
      await classifyOutliers(allOutliers, anthropicKey);
      console.log('✅ Clasificación completada');
    } catch (err) {
      console.error(`⚠️  Error en clasificación: ${err.message} — continuando sin categorías`);
    }
  }

  if (allOutliers.length === 0) {
    console.log('ℹ️  No hay outliers hoy. No se enviará email.');
    return;
  }

  const payload = buildPayload(allOutliers);

  const savedToRedis = await saveOutliersToRedis(payload);
  if (savedToRedis) console.log('💾 Guardado en Redis (Upstash)');
  try {
    fs.writeFileSync(OUTLIERS_FILE, JSON.stringify(payload, null, 2));
    console.log('💾 Guardado en outliers.json (local)');
  } catch {}

  console.log('\n📧 Enviando email...');
  await sendOutlierEmail(resendKey, emailTo, emailFrom, allOutliers);
  console.log(`✅ Email enviado a ${emailTo}`);

  console.log('\nTop 5 outliers:');
  allOutliers.slice(0, 5).forEach((v, i) => {
    console.log(`  ${i + 1}. [${v.score}] ${v.title.slice(0, 60)}...`);
  });
}

module.exports = { runAnalysis };
