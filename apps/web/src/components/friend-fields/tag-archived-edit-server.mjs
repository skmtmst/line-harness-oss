/*
  Issue #710 の実挙動を「実build」へ当てるための静的配信。

  `contents-permission-behavior-server.mjs`（N-197）と同じ形。管理画面は
  `next.config.ts` が `output: 'export'` なので `next start` は使えない。
  `apps/web/out` をそのまま配ると `/tags/edit` のような拡張子なしパスが
  404になるため、Cloudflare Pages と同じ当て方（`<path>.html` を探す）を
  ここで再現する。
*/
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../../../out/', import.meta.url)))
const PORT = Number(process.env.TAG_ARCHIVED_EDIT_PORT ?? 3110)
const HOST = process.env.TAG_ARCHIVED_EDIT_HOST ?? '127.0.0.1'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** `out` の外は決して読ませない。`..` を含む要求は候補から外れる。 */
function resolveInsideRoot(pathname) {
  const candidate = resolve(join(ROOT, normalize(pathname)))
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
  return candidate
}

function isFile(path) {
  return Boolean(path) && existsSync(path) && statSync(path).isFile()
}

function resolveStaticFile(pathname) {
  const clean = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname
  const base = clean === '' ? '/' : clean
  const candidates = base === '/'
    ? [resolveInsideRoot('/index.html')]
    : [
        resolveInsideRoot(base),
        resolveInsideRoot(`${base}.html`),
        resolveInsideRoot(`${base}/index.html`),
      ]
  return candidates.find((candidate) => isFile(candidate)) ?? null
}

const server = createServer((request, response) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname)
  } catch {
    response.writeHead(400).end('bad request')
    return
  }

  const file = resolveStaticFile(pathname)
  const found = file ?? resolveInsideRoot('/404.html')
  if (!isFile(found)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
    return
  }

  response.writeHead(file ? 200 : 404, {
    'content-type': CONTENT_TYPES[extname(found)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  createReadStream(found).pipe(response)
})

server.listen(PORT, HOST, () => {
  process.stdout.write(`tag archived-edit static server: http://${HOST}:${PORT} (${ROOT})\n`)
})
