import { afterAll, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const guard = fileURLToPath(new URL('./local-test-network-guard.mjs', import.meta.url));
const server = createServer((_req, res) => res.end('人工データ'));
afterAll(() => server.close());
test.each([
  'await fetch("https://outside.invalid/fixture")',
  'await fetch(new Request("https://outside.invalid/fixture"))',
  'https.request(new URL("https://outside.invalid/fixture"))',
  'https.get({ hostname: "outside.invalid", path: "/fixture" })',
])('手元の試験の外部通信を接続前に拒否する: %s', async operation => {
  const code = `import https from 'node:https'; try { ${operation}; process.exit(3); } catch (error) { if (error.code !== 'REVFIX_EXTERNAL_BLOCKED') throw error; }`;
  const result = await run(process.execPath, ['--import', guard, '--input-type=module', '-e', code]);
  expect(result.stderr).toBe('');
});
test('手元の人工APIへのHTTPは許可する', async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('人工APIが起動しません');
  const { stdout } = await run(process.execPath, ['--import', guard, '--input-type=module', '-e', `console.log(await (await fetch('http://127.0.0.1:${address.port}/fixture')).text())`]);
  expect(stdout.trim()).toBe('人工データ');
});
