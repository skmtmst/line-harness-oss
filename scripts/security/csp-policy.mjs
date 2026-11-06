import assert from 'node:assert/strict';

/** Parse the single catch-all block used by these static builds. */
export function securityHeaders(source) {
  const headers = {};
  assert.equal(source.split('\n').filter(line => line && !/^\s|#/.test(line)).join('\n'), '/*');
  for (const line of source.split('\n')) {
    assert.ok(line.length <= 2000, 'Cloudflare header line limit');
    const match = /^\s+([^:]+):\s*(.+)$/.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    assert.ok(!headers[name], 'duplicate policy headers intersect unexpectedly');
    headers[name] = match[2];
  }
  assert.ok(headers['content-security-policy']);
  return headers;
}

export function assertEnforcedPolicy(headers, target) {
  const report = headers['content-security-policy'];
  assert.ok(report, 'enforced CSP required in production build');
  const directives = new Map(report.split(';').map(part => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources];
  }));
  const scripts = directives.get('script-src') ?? [];
  for (const dangerous of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:']) assert.ok(!scripts.includes(dangerous));
  assert.ok(scripts.includes('https://static.line-scdn.net'));
  if (target === 'web') assert.ok(scripts.includes('https://challenges.cloudflare.com'));
  assert.deepEqual(directives.get('script-src-attr'), ["'none'"]);
  assert.ok(directives.get('form-action')?.includes("'self'"));
  assert.ok(directives.get('style-src')?.includes('https://fonts.googleapis.com'));
  assert.ok(directives.get('font-src')?.includes('https://fonts.gstatic.com'));
  assert.ok(directives.get('connect-src')?.includes('https:'));
  assert.ok(!headers['content-security-policy-report-only'], 'policy must be enforced');
  assert.deepEqual(directives.get('worker-src'), ["'self'", 'blob:']);
  assert.ok(directives.get('frame-src')?.includes('blob:'));
  assert.ok(!report.includes('*'), 'name specific hosts');
}
