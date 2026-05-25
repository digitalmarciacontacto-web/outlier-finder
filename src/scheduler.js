const cron = require('node-cron');
const { runAnalysis } = require('../analyzer');

function startScheduler() {
  console.log('⏰ Cron configurado para las 8:00 AM diariamente (America/Mexico_City).');
  console.log('   Usa "npm run run-now" para ejecutar un análisis inmediato.\n');

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

module.exports = { startScheduler };
