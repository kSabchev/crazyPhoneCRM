// Entry point: builds the app (app.js) and starts listening. Kept separate
// so tests can load the app without opening a real port.
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Last-resort handlers for errors nothing else caught. The process state
// can't be trusted after one of these, so log it with a timestamp (lands
// in the NSSM/pm2 log) and exit — the service manager restarts the app.
process.on('uncaughtException', err => {
  console.error(`[${new Date().toISOString()}] Uncaught exception — exiting:`, err);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error(`[${new Date().toISOString()}] Unhandled promise rejection — exiting:`, reason);
  process.exit(1);
});

// Public demo (e.g. on Render): start from fresh demo data every time.
if (process.env.DEMO_MODE === 'true') {
  try {
    require('./demo').prepareDemo(require('./db'));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

app.listen(PORT, () => {
  console.log(`Repair log running at http://localhost:${PORT}`);
});

// Hourly housekeeping (see app.runMaintenance), plus once right away.
// A failure is logged and retried next hour rather than crashing the app.
function runMaintenance() {
  try {
    app.runMaintenance();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Maintenance failed:`, err);
  }
}
runMaintenance();
setInterval(runMaintenance, 60 * 60 * 1000).unref();
