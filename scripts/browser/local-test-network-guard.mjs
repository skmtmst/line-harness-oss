import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
function rejectExternal(input) {
  let hostname;
  if (typeof input === 'string' || input instanceof URL) hostname = new URL(input, 'http://127.0.0.1').hostname;
  else hostname = input?.hostname ?? input?.host?.split(':')[0];
  if (hostname && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) throw Object.assign(new Error('外部通信は人工データの試験では禁止'), { code: 'REVFIX_EXTERNAL_BLOCKED' });
}
for (const module of [http, https]) for (const name of ['request', 'get']) {
  const original = module[name];
  module[name] = function (...args) { rejectExternal(args[0]); return original.apply(this, args); };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => { rejectExternal(input instanceof Request ? input.url : input); return originalFetch(input, init); };
syncBuiltinESMExports();
