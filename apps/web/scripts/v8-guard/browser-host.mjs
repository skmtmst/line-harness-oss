import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const args = process.argv.slice(2)
if (!args.length) throw new Error('browser-host requires a Node command')
const server = await chromium.launchServer()
let child
const stop = signal => child?.kill(signal)
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, V8_GUARD_BROWSER_WS: server.wsEndpoint() },
  })
  const [code, signal] = await once(child, 'exit')
  process.exitCode = code ?? (signal ? 1 : 0)
} finally {
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
  await server.close()
}
