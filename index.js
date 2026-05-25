require('dotenv').config();
const { runAnalysis } = require('./analyzer');
const { startServer } = require('./server');
const { startScheduler } = require('./src/scheduler');

const runNow = process.argv.includes('--now');

if (runNow) {
  console.log('🔍 Ejecutando análisis manual...');
  runAnalysis().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
} else {
  startServer();
  startScheduler();
}
