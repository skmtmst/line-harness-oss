/*
  N-197 の権限契約試験を「実build」へ当てるための静的配信。

  管理画面は `next.config.ts` が `output: 'export'` なので、`next start` は
  使えない。`apps/web/out` をそのまま配るしかないが、**素朴なディレクトリ配信は
  `/contents` を `/contents/` へ 308 で送ってしまう。** `out/contents` は
  `vars` だけを持つ枝で `index.html` が無いため、そこで 404 になる。
  司令塔の再審査で「静的出力は /contents/ へ遷移する」と出たのはこれ。

  Cloudflare Pages は拡張子なしのパスを `<path>.html` へ当てる。本番と同じ
  当て方をここで再現する。リダイレクトは出さない。
*/
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../../../out/', import.meta.url)))
const PORT = Number(process.env.MEDIA_PERMISSION_PORT ?? 3109)
const HOST = process.env.MEDIA_PERMISSION_HOST ?? '127.0.0.1'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** `out` の外は決して読ませない。`..` を含む要求は 400 で落とす。 */
function resolveInsideRoot(pathname) {
  const candidate = resolve(join(ROOT, normalize(pathname)))
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
  return candidate
}

function isFile(path) {
  return Boolean(path) && existsSync(path) && statSync(path).isFile()
}

/** Cloudflare Pages と同じ当て方。**送り先を変えず、その場で中身を返す。** */
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
  process.stdout.write(`media permission static server: http://${HOST}:${PORT} (${ROOT})\n`)
})
