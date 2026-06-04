const cron = require('node-cron');
const { runAnalysis } = require('../analyzer');

function startScheduler() {
  console.log('⏰ Cron configurado para LUNES 9:00 AM (America/Mexico_City) — análisis semanal.');
  console.log('   Usa "npm run run-now" para ejecutar un análisis inmediato.\n');

  cron.schedule('0 9 * * 1', async () => {
    console.log(`\n[${new Date().toISOString()}] ⏰ Ejecutando análisis semanal (lunes)...`);
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

module.exports = { startScheduler };
