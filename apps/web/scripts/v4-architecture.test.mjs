import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { inspectV4Registry } from './v4-architecture.mjs'

function fixture(viewSource, featureResult = 'retained') {
  const root = mkdtempSync(resolve(tmpdir(), 'line-harness-v4-'))
  const files = {
    'src/app/example/page.tsx': "import ExampleView from '../../components/v4/example-view'; export default function Page(){ return <ExampleView title='例' /> }",
    'src/components/v4/example-view.tsx': viewSource,
    'src/components/v4/example-view.module.css': '.screen { --v4-example-ink: #222; color: var(--v4-example-ink); }',
  }
  for (const [path, content] of Object.entries(files)) {
    const absolute = resolve(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content)
  }
  writeFileSync(resolve(root, 'v4-screens.json'), JSON.stringify({ schemaVersion: 1, screens: [{
    id: 'example', title: '例', route: '/example', status: 'building', productionConnected: false,
    controller: 'src/app/example/page.tsx', view: 'src/components/v4/example-view.tsx', viewExport: 'ExampleView',
    stylesheet: 'src/components/v4/example-view.module.css', nodeId: 'abc12', states: [{ id: 'default', nodeId: 'abc12' }],
    legacyRoutes: [], legacyFiles: [], featureParity: [{ id: 'list', label: '一覧', result: featureResult }],
  }] }))
  return root
}

const validView = "import styles from './example-view.module.css'; export interface ExampleViewProps { title: string }; export default function ExampleView(props: ExampleViewProps){ return <main className={styles.screen} data-design-node=\"abc12\">{props.title}</main> }"

test('propsだけのCSS Module Viewは合格する', () => {
  const result = inspectV4Registry(fixture(validView))
  assert.deepEqual(result.errors, [])
})

test('Tailwindと状態HookがV4 Viewへ混ざると失敗する', () => {
  const invalid = `${validView}\nconst bad = () => { useState(false); return <div className=\"text-gray-500 rounded-lg\" /> }`
  const result = inspectV4Registry(fixture(invalid))
  assert.ok(result.errors.some((error) => error.includes('状態Hook')))
  assert.ok(result.errors.some((error) => error.includes('Tailwind')))
})

test('本番接続済みを完成扱いにすると未移植機能を許可しない', () => {
  const root = fixture(validView, 'missing')
  const registryPath = resolve(root, 'v4-screens.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  registry.screens[0].status = 'ready'
  registry.screens[0].productionConnected = true
  writeFileSync(registryPath, JSON.stringify(registry))
  const result = inspectV4Registry(root)
  assert.ok(result.errors.some((error) => error.includes('未移植機能')))
})
