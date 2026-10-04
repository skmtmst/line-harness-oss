/*
 * 偽APIの応答器を直接呼ぶ（待ち受けなし）。
 *
 * `mock-api.mjs` は `createServer(listener)` のあと `listen` するだけなので、
 * http を偽物にして読み込むと、本物の listener が手に入る。
 * 返す中身は起こしたときとまったく同じ。測る道具（speed-budget.mjs）の
 * `--local-stub` が、ブラウザの通信差し替えからこれを呼ぶ。
 */
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(join(HERE, 'mock-local-hooks.mjs')).href)

await import('../../../../scripts/visual-qa/mock-api.mjs')

const listener = globalThis.__mockListener
if (typeof listener !== 'function') throw new Error('偽APIの応答器が取れなかった')

/* 本物の応答器へ、method と path（query 付き）だけ渡して答えをもらう。 */
export function mockFetch(method, path) {
  return new Promise((resolve) => {
    let done = false
    const finish = (value) => {
      if (!done) {
        done = true
        resolve(value)
      }
    }
    const req = { url: path, method, headers: {} }
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[String(k).toLowerCase()] = v
        return this
      },
      writeHead(code, extra) {
        this.statusCode = code
        Object.assign(this.headers, extra ?? {})
        return this
      },
      end(body) {
        finish({ status: this.statusCode, headers: this.headers, body: String(body ?? '') })
      },
    }
    try {
      const out = listener(req, res)
      if (out?.catch) out.catch((e) => finish({ status: 500, headers: {}, body: String(e) }))
    } catch (e) {
      finish({ status: 500, headers: {}, body: String(e) })
    }
    setTimeout(() => finish({ status: 500, headers: {}, body: 'mock-local timeout' }), 8000)
  })
}
