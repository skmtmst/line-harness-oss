import { createServer } from 'node:net'

async function reservePort(value) {
  if (value !== undefined) {
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid webhook test port')
    return { port, close: async () => {} }
  }
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) }
}

const api = await reservePort(process.env.WEBHOOK_RUNTIME_API_PORT)
const web = await reservePort(process.env.WEBHOOK_RUNTIME_PORT)
process.env.WEBHOOK_RUNTIME_API_PORT = String(api.port)
process.env.WEBHOOK_RUNTIME_PORT = String(web.port)
process.env.WEBHOOK_RUNTIME_BASE = `http://127.0.0.1:${web.port}`
await Promise.all([api.close(), web.close()])

export default (await import('../../apps/web/src/app/webhooks/webhook-runtime.config.mjs')).default
