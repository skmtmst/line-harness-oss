import { createServer } from 'node:net'

/** 並行するブラウザ検査ごとに空きポートを選ぶ。明示した値はそのまま使う。 */
export async function allocateTestPort(explicit) {
  if (explicit !== undefined) return Number(explicit)
  const server = createServer()
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}
