import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { CfApiCreds } from '../types.js';
import { authHeader, workersApiBase } from './shared.js';

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain', '.map': 'application/json' };
async function result<T>(response: Response, operation: string): Promise<T> {
  if (!response.ok) throw new Error(`${operation}: HTTP ${response.status}`);
  const body = await response.json() as { success: boolean; result: T };
  if (!body.success || !body.result) throw new Error(`${operation}: unsuccessful response`);
  return body.result;
}

/** Direct uploads API: stage assets, then bind the completion token on the script upload. */
export async function uploadWorkerAssets(opts: { creds: CfApiCreds; scriptName: string; files: ReadonlyMap<string, Buffer> }): Promise<string> {
  if (!opts.files.has('index.html')) throw new Error('worker_assets_index_missing');
  const manifest: Record<string, { hash: string; size: number }> = {};
  const byHash = new Map<string, { bytes: Buffer; type: string }>();
  for (const [path, bytes] of opts.files) {
    if (path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.') || path.includes('\\')) throw new Error('worker_asset_path_invalid');
    if (path === '_headers' || path === '_redirects') continue;
    const extension = extname(path);
    const hash = createHash('sha256').update(bytes.toString('base64') + extension).digest('hex').slice(0, 32);
    manifest[`/${path}`] = { hash, size: bytes.byteLength };
    byHash.set(hash, { bytes, type: TYPES[extension] ?? 'application/octet-stream' });
  }
  const session = await result<{ jwt: string; buckets: string[][] }>(await fetch(
    `${workersApiBase(opts.creds.accountId)}/${opts.scriptName}/assets-upload-session`, {
      method: 'POST', headers: { ...authHeader(opts.creds.apiToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }),
    }), 'worker_assets_session');
  if (!session.jwt || !Array.isArray(session.buckets)) throw new Error('worker_assets_session_invalid');
  if (!session.buckets.length) return session.jwt;
  let completion: string | undefined;
  for (const bucket of session.buckets) {
    const body = new FormData();
    for (const hash of bucket) {
      const file = byHash.get(hash);
      if (!file) throw new Error('worker_assets_unknown_hash');
      body.append(hash, new Blob([file.bytes.toString('base64')], { type: file.type }), hash);
    }
    const uploaded = await result<{ jwt?: string }>(await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${opts.creds.accountId}/workers/assets/upload?base64=true`,
      { method: 'POST', headers: authHeader(session.jwt), body }), 'worker_assets_upload');
    if (uploaded.jwt) completion = uploaded.jwt;
  }
  if (!completion) throw new Error('worker_assets_completion_missing');
  return completion;
}

/** Probe every shipped asset: a generic 200 SPA fallback cannot prove this release was deployed. */
export async function verifyWorkerAssets(origin: string, files: ReadonlyMap<string, Buffer>): Promise<void> {
  if (!origin || !files.has('index.html')) throw new Error('worker_assets_verify_input_missing');
  for (const [path, bytes] of files) {
    if (path === '_headers' || path === '_redirects') continue;
    const url = new URL(path, origin.replace(/\/$/, '') + '/');
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`worker_asset_unavailable: ${path}`);
        const actual = Buffer.from(await response.arrayBuffer());
        if (!actual.equals(bytes)) throw new Error(`worker_asset_content_mismatch: ${path}`);
        failure = undefined;
        break;
      } catch (error) { failure = error; }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (failure) throw failure;

  }
}

/** The shared release cannot embed an individual install's default LIFF identifier. */
export function materializeWorkerAssets(files: ReadonlyMap<string, Buffer> | undefined, liffId = ''): Map<string, Buffer> {
  if (!files?.has('index.html')) throw new Error('worker_assets_bundle_missing: this release cannot update Worker-assets installs');
  if (liffId && !/^[A-Za-z0-9-]+$/.test(liffId)) throw new Error('worker_assets_liff_id_invalid');
  return new Map(Array.from(files, ([path, bytes]) => [path, /\.(?:html|js)$/.test(path)
    ? Buffer.from(bytes.toString('utf8').replaceAll('__MUSUBO_LIFF_ID__', liffId)) : bytes]));
}
export function workerAssetsConfig(files: ReadonlyMap<string, Buffer>): { run_worker_first: true; _headers?: string; _redirects?: string } {
  return { run_worker_first: true,
    ...(files.has('_headers') ? {_headers: files.get('_headers')!.toString('utf8')} : {}),
    ...(files.has('_redirects') ? {_redirects: files.get('_redirects')!.toString('utf8')} : {}),
  };
}
