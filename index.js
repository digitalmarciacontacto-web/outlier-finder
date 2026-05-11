require('dotenv').config();
const cron = require('node-cron');
const { runAnalysis } = require('./analyzer');

// Ejecuta el análisis de forma inmediata si se pasa --now como argumento
const runNow = process.argv.includes('--now');

if (runNow) {
  console.log('🔍 Ejecutando análisis manual...');
  runAnalysis().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
} else {
  console.log('⏰ Outlier Finder iniciado. Cron configurado para las 8:00 AM diariamente.');
  console.log('   Usa "node index.js --now" para ejecutar un análisis inmediato.\n');

  // Todos los días a las 8:00 AM (hora local del servidor)
  cron.schedule('0 8 * * *', async () => {
    console.log(`\n[${new Date().toISOString()}] ⏰ Ejecutando análisis diario...`);
    try {
      await runAnalysis();
    } catch (err) {
      console.error('Error en análisis programado:', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'America/Mexico_City',
  });
}
