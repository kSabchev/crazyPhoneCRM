// In demo mode (server started with DEMO_MODE=true) every page shows a DEMO
// banner, and the login form is pre-filled with the demo account. Outside
// demo mode this does nothing.
(async function(){
  let info;
  try {
    const res = await fetch('/api/demo');
    info = await res.json();
  } catch (_) { return; }
  if (!info || !info.demo) return;

  const logins = info.users.map(u => `${u.username} / ${u.password}`).join(' или ');
  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.setAttribute('role', 'note');
  banner.textContent = `ДЕМО версия — всички данни са измислени и се нулират при рестартиране. Вход: ${logins}`;
  document.body.prepend(banner);

  const user = document.getElementById('loginUser');
  const pass = document.getElementById('loginPass');
  if (user && pass && !user.value && !pass.value) {
    user.value = info.users[0].username;
    pass.value = info.users[0].password;
  }
})();
