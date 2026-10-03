// Loads settings from .env — except in automated tests, which set
// CRAZYPHONE_TEST=1 so they never pick up the real .env (e.g. a live
// SMSAPI_TOKEN would make tests send real SMS). Required instead of
// require('dotenv').config() everywhere.
if (process.env.CRAZYPHONE_TEST !== '1') {
  require('dotenv').config();
}
