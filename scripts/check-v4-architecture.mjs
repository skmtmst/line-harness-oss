import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const ledgerPath = resolve(root, 'apps/web/v4-screens.json')
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
const allowedStatuses = new Set(['retained', 'added', 'missing', 'approved-removal'])
const forbiddenViewTokens = [
  'fetch(',
  '/api/',
  'localStorage',
  'sessionStorage',
  'useEffect',
  'useRouter',
  'useSearchParams',
  'useState',
]

if (ledger.version !== 1 || !Array.isArray(ledger.screens) || ledger.screens.length === 0) {
  throw new Error('apps/web/v4-screens.json must contain version 1 and at least one screen')
}

for (const screen of ledger.screens) {
  if (!screen.id || !screen.title || !screen.scope || !screen.view) {
    throw new Error('Every V4 screen needs id, title, scope, and view')
  }
  if (!Array.isArray(screen.routes) || screen.routes.length === 0) {
    throw new Error(`${screen.id}: routes are required`)
  }
  if (!Array.isArray(screen.states) || screen.states.length === 0) {
    throw new Error(`${screen.id}: states are required`)
  }
  for (const state of screen.states) {
    if (!state.name || !/^[A-Za-z0-9]{5,}$/.test(state.pencilNodeId)) {
      throw new Error(`${screen.id}: every state needs a real Pencil node ID`)
    }
  }
  if (!Array.isArray(screen.features) || screen.features.length === 0) {
    throw new Error(`${screen.id}: features are required`)
  }
  for (const feature of screen.features) {
    if (!allowedStatuses.has(feature.status)) {
      throw new Error(`${screen.id}: invalid feature status ${feature.status}`)
    }
    if (feature.status === 'missing') {
      throw new Error(`${screen.id}: missing feature remains: ${feature.name}`)
    }
  }

  const viewSource = readFileSync(resolve(root, 'apps/web', screen.view), 'utf8')
  for (const token of forbiddenViewTokens) {
    if (viewSource.includes(token)) {
      throw new Error(`${screen.id}: display layer contains forbidden token ${token}`)
    }
  }
}

console.log(`V4 architecture check passed for ${ledger.screens.length} screen(s).`)
