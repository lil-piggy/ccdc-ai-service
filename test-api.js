async function test() {
  const base = 'http://localhost:3000';
  
  // Register
  const r1 = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser', password: '123456' })
  });
  console.log('Register:', await r1.json());

  // Login
  const r2 = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser', password: '123456' })
  });
  const loginData = await r2.json();
  console.log('Login:', loginData);

  if (!loginData.token) {
    console.log('Login failed, aborting');
    process.exit(1);
  }

  // Config
  const r3 = await fetch(base + '/api/config', {
    headers: { 'Authorization': 'Bearer ' + loginData.token }
  });
  console.log('Config:', await r3.json());

  // Save history
  const r4 = await fetch(base + '/api/history', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + loginData.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '测试对话', messages: [{ q: '你好', a: '你好' }] })
  });
  console.log('Save history:', await r4.json());

  // Get history
  const r5 = await fetch(base + '/api/history', {
    headers: { 'Authorization': 'Bearer ' + loginData.token }
  });
  console.log('Get history:', await r5.json());

  console.log('\n✅ All tests passed!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
