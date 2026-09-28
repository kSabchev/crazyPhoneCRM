// Entry point: builds the app (app.js) and starts listening. Kept separate
// so tests can load the app without opening a real port.
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Repair log running at http://localhost:${PORT}`);
});
