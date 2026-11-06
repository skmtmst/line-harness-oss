import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';

/** 実際のサービスをbundleし、ネットワークを使わずworkerdのfetchで転送を試す。 */
export async function redirectWorker(contents: string): Promise<Miniflare> {
  const require = createRequire(import.meta.url);
  const viteRequire = createRequire(require.resolve('vite'));
  const esbuild = viteRequire('esbuild') as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
  };
  const bundle = await esbuild.build({
    stdin: { contents, resolveDir: resolve(process.cwd(), 'src'), sourcefile: 'redirect-fixture.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['node:async_hooks'],
  });
  return new Miniflare({
    workers: [
      { name: 'caller', modules: true, script: bundle.outputFiles[0].text, outboundService: 'destination',
        compatibilityDate: '2024-12-01', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'] },
      { name: 'destination', modules: true, script: `
        let seen = [];
        export default { async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/seen') return Response.json(seen);
          if (url.pathname === '/reset') { seen = []; return new Response('ok'); }
          seen.push({ host: url.hostname, path: url.pathname, method: request.method,
            authenticated: request.headers.get('authorization') === 'Bearer synthetic-scan-token',
            customAuthenticated: request.headers.get('x-api-key') === 'synthetic-webhook-token',
            body: await request.text() });
          if (url.pathname === '/trace') return Response.json({ requestId: request.headers.get('X-Request-ID') });
          if (url.pathname === '/redirect') return new Response(null, { status: Number(url.searchParams.get('status') || 302),
            headers: { location: url.searchParams.get('target') || 'https://evil.example.com/stolen' } });
          return Response.json({ verdict: 'clean', eligible: true });
        } }
      ` },
    ],
  });
}
