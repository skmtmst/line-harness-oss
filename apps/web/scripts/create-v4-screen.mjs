import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const name = args.name
const title = args.title
const route = args.route
const nodeId = args['node-id']

if (!name || !/^[a-z][a-z0-9-]*$/.test(name) || !title || !route?.startsWith('/') || !/^[A-Za-z0-9]{5,}$/.test(nodeId ?? '')) {
  console.error('使い方: pnpm create:v4-screen --name=画面id --title=画面名 --route=/route --node-id=Pencil実ノードID')
  process.exit(1)
}

const webRoot = resolve(import.meta.dirname, '..')
const registryPath = resolve(webRoot, 'v4-screens.json')
const componentDir = resolve(webRoot, 'src/components/v4', name)
const viewPath = resolve(componentDir, `${name}-view.tsx`)
const cssPath = resolve(componentDir, `${name}-view.module.css`)
if (existsSync(viewPath) || existsSync(cssPath)) {
  console.error(`${name} のV4 Viewはすでに存在します。上書きしません。`)
  process.exit(1)
}

const pascal = name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')
const routeDir = route.replace(/^\/+|\/+$/g, '')
mkdirSync(dirname(viewPath), { recursive: true })
writeFileSync(viewPath, `import styles from './${name}-view.module.css'\n\nexport interface ${pascal}ViewProps {\n  title: string\n}\n\nexport default function ${pascal}View(props: ${pascal}ViewProps) {\n  return (\n    <main className={styles.screen} data-design-node="${nodeId}">\n      <h1>{props.title}</h1>\n    </main>\n  )\n}\n`)
writeFileSync(cssPath, `.screen {\n  --v4-${name}-ink: #202124;\n  width: 100%;\n  color: var(--v4-${name}-ink);\n}\n`)

const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
if (registry.screens.some((screen) => screen.id === name || screen.route === route)) {
  console.error('同じ画面IDまたはルートが台帳にあります。作成ファイルは残しているため、内容を確認してください。')
  process.exit(1)
}
registry.screens.push({
  id: name,
  title,
  route,
  status: 'planned',
  productionConnected: false,
  controller: routeDir ? `src/app/${routeDir}/page.tsx` : 'src/app/page.tsx',
  view: `src/components/v4/${name}/${name}-view.tsx`,
  viewExport: `${pascal}View`,
  stylesheet: `src/components/v4/${name}/${name}-view.module.css`,
  nodeId,
  states: [{ id: 'default', nodeId }],
  legacyRoutes: [],
  legacyFiles: [],
  featureParity: [{ id: 'current-feature-inventory', label: '現行画面の全機能を棚卸しする', result: 'pending' }],
})
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

console.log(`${title} のV4専用Viewを新規作成しました。`)
console.log('次に v4-screens.json の featureParity を埋め、現行機能を retained / added / missing に分類してください。')
