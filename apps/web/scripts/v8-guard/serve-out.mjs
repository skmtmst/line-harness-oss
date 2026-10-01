/*
 * 書き出した `out` を配るだけの小さな静的サーバー（/a → /a.html）。
 *
 *   node apps/web/scripts/v8-guard/serve-out.mjs <outDir> <port>
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

const [dirArg, portArg] = process.argv.slice(2)
const root = resolve(dirArg ?? 'apps/web/out')
const port = Number(portArg ?? 4310)
if (!existsSync(root)) throw new Error(`${root} がありません。先に書き出してください。`)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.webp': 'image/webp',
}

createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (p.endsWith('/')) p += 'index'
  for (const c of [p, `${p}.html`, join(p, 'index.html')]) {
    const f = join(root, c)
    if (f.startsWith(root) && existsSync(f) && statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
      createReadStream(f).pipe(res)
      return
    }
  }
  const nf = join(root, '404.html')
  res.writeHead(404, { 'content-type': 'text/html' })
  if (existsSync(nf)) createReadStream(nf).pipe(res)
  else res.end('404')
}).listen(port, '127.0.0.1', () => console.log(`serve ${root} on ${port}`))
