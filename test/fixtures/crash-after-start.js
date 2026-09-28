// Preloaded (node -r) into server.js by robustness.test.js: once the
// server has had time to start, trigger the failure named in CRASH_KIND.
setTimeout(() => {
  if (process.env.CRASH_KIND === 'rejection') {
    Promise.reject(new Error('test crash'));
  } else {
    throw new Error('test crash');
  }
}, 1000);
