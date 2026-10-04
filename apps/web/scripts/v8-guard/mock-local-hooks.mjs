/*
 * 偽APIを待ち受けなしで借りるための仕掛け。
 *
 * 手元の砂場では TCP の待ち受けが禁止され、mock-api.mjs を起こせない。
 * そこで `node:http` だけを偽物に差し替え、本物の応答器（listener）を
 * 捕まえる。中身のデータ・形は本物そのまま。待ち受けだけしない。
 */
export async function resolve(specifier, context, next) {
  if (specifier === 'node:http') return { url: 'stub:node-http', shortCircuit: true }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url === 'stub:node-http') {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        export function createServer(listener) {
          globalThis.__mockListener = listener
          return { listen() {}, on() {}, close() {} }
        }
        export default { createServer }
      `,
    }
  }
  return next(url, context)
}
