import { createServer } from 'node:net'

if (process.env.EC_685_PORT === undefined) {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  process.env.EC_685_PORT = String(server.address().port)
  await new Promise(resolve => server.close(resolve))
}
const port = Number(process.env.EC_685_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid EC test port')
process.env.EC_685_BASE = `http://127.0.0.1:${port}`
export default (await import('../../apps/web/src/app/ec-commerce/ec-commerce-issue-685.config.mjs')).default
