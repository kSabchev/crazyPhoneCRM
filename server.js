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

app.listen(PORT, () => {
  console.log(`Repair log running at http://localhost:${PORT}`);
});
