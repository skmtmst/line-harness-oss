import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import original from '../../apps/web/src/v8/login/auth.config.mjs'

async function reservePort(value) {
  if (value !== undefined) {
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid auth test port')
    return { port, close: async () => {} }
  }
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) }
}
const web = await reservePort(process.env.TRAIN30_WEB_PORT)
const mock = await reservePort(process.env.TRAIN30_MOCK_PORT)
process.env.TRAIN30_WEB_PORT = String(web.port)
process.env.TRAIN30_MOCK_PORT = String(mock.port)
const webUrl = `http://127.0.0.1:${web.port}`
await Promise.all([web.close(), mock.close()])

export default {
  ...original,
  testDir: fileURLToPath(new URL('../../apps/web/src/v8/login', import.meta.url)),
  use: { ...original.use, baseURL: webUrl },
  webServer: [
    { ...original.webServer[0], command: `node apps/web/scripts/v8-guard/serve-out.mjs apps/web/out ${web.port}`, url: `${webUrl}/login` },
    { ...original.webServer[1], env: { ...original.webServer[1].env, PORT: String(mock.port) }, url: `http://127.0.0.1:${mock.port}/api/friends?account_id=visual-qa-account` },
  ],
}
