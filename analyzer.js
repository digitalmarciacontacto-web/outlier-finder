require('dotenv').config();
const { analyzeChannel } = require('./youtube');
const { sendOutlierEmail } = require('./email');
const channels = require('./channels.json');

const OUTLIER_THRESHOLD = 200;

async function runAnalysis() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.EMAIL_TO;
  const emailFrom = process.env.EMAIL_FROM || 'outlier-finder@resend.dev';

  if (!apiKey || !resendKey || !emailTo) {
    throw new Error('Faltan variables de entorno: YOUTUBE_API_KEY, RESEND_API_KEY, EMAIL_TO');
  }

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

  if (allOutliers.length === 0) {
    console.log('ℹ️  No hay outliers hoy. No se enviará email.');
    return;
  }

  console.log('\n📧 Enviando email...');
  await sendOutlierEmail(resendKey, emailTo, emailFrom, allOutliers);
  console.log(`✅ Email enviado a ${emailTo}`);

  console.log('\nTop 5 outliers:');
  allOutliers.slice(0, 5).forEach((v, i) => {
    console.log(`  ${i + 1}. [${v.score}] ${v.title.slice(0, 60)}...`);
  });
}

module.exports = { runAnalysis };
