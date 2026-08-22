import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const REAL_NODE_ID = /^[A-Za-z0-9]{5,}$/
const VALID_SCREEN_STATUS = new Set(['planned', 'building', 'migration', 'ready', 'verified'])
const VALID_FEATURE_RESULT = new Set(['retained', 'added', 'missing', 'approved-removal', 'pending'])

const VIEW_FORBIDDEN = [
  [/@\/lib\/api|\bfetch\s*\(|\baxios\b/, 'ViewにAPI・通信処理を入れないでください'],
  [/\buse(?:State|Effect|Reducer|Memo|Callback|SyncExternalStore)\s*\(/, 'Viewに状態Hookを入れないでください'],
  [/next\/navigation|\buseRouter\s*\(|\buseSearchParams\s*\(/, 'Viewにルーター状態を入れないでください'],
  [/\b(?:localStorage|sessionStorage)\b/, 'Viewにブラウザ保存処理を入れないでください'],
  [/className\s*=\s*["'][^"']+(?:text-gray-|text-slate-|bg-canvas|rounded-lg)[^"']*["']/, '旧デザインのTailwindクラスを使わないでください'],
  [/className\s*=\s*["'][^"']*["']/, 'V4 Viewの見た目はCSS Moduleで指定してください'],
  [/from\s+["'][^"']*(?:-v2|-v3|\/v2\/|\/v3\/)[^"']*["']/, 'V2/V3の表示部品を参照しないでください'],
]

function inside(root, relativePath) {
  const absolute = resolve(root, relativePath)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`管理対象外のパスです: ${relativePath}`)
  }
  return absolute
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function inspectV4Registry(webRoot, registryPath = resolve(webRoot, 'v4-screens.json')) {
  const errors = []
  const warnings = []
  const registry = loadJson(registryPath)
  const repositoryRoot = resolve(webRoot, '..', '..')
  if (registry.schemaVersion !== 1) errors.push('v4-screens.json の schemaVersion は 1 にしてください')
  if (!Array.isArray(registry.screens)) errors.push('v4-screens.json に screens 配列が必要です')

  const ids = new Set()
  const routes = new Set()
  for (const screen of registry.screens ?? []) {
    const label = screen.id || '(idなし)'
    if (!screen.id || ids.has(screen.id)) errors.push(`${label}: idが無いか重複しています`)
    ids.add(screen.id)
    if (!screen.route?.startsWith('/') || routes.has(screen.route)) errors.push(`${label}: routeが無いか重複しています`)
    routes.add(screen.route)
    if (!VALID_SCREEN_STATUS.has(screen.status)) errors.push(`${label}: statusが不正です`)
    if (!REAL_NODE_ID.test(screen.nodeId ?? '')) errors.push(`${label}: 実PencilノードIDを記録してください`)

    for (const key of ['controller', 'view', 'stylesheet']) {
      if (!screen[key]) {
        errors.push(`${label}: ${key}が未設定です`)
        continue
      }
      const path = inside(webRoot, screen[key])
      if (!existsSync(path)) errors.push(`${label}: ${screen[key]} が存在しません`)
    }

    const viewPath = screen.view ? inside(webRoot, screen.view) : null
    if (viewPath && existsSync(viewPath)) {
      const source = readFileSync(viewPath, 'utf8')
      if (!/export interface \w+ViewProps/.test(source)) errors.push(`${label}: props契約の *ViewProps がありません`)
      if (!source.includes('.module.css')) errors.push(`${label}: CSS Moduleを読み込んでいません`)
      if (!source.includes(`data-design-node="${screen.nodeId}"`)) errors.push(`${label}: Viewのdata-design-nodeと台帳が一致しません`)
      for (const [pattern, message] of VIEW_FORBIDDEN) {
        if (pattern.test(source)) errors.push(`${label}: ${message}`)
      }
    }

    const cssPath = screen.stylesheet ? inside(webRoot, screen.stylesheet) : null
    if (cssPath && existsSync(cssPath)) {
      const css = readFileSync(cssPath, 'utf8')
      if (!css.includes('--v4-')) errors.push(`${label}: CSS変数は --v4- 接頭辞で画面側に固定してください`)
      if (/@tailwind|@apply/.test(css)) errors.push(`${label}: V4のCSS ModuleでTailwindを使わないでください`)
    }

    const controllerPath = screen.controller ? inside(webRoot, screen.controller) : null
    if (controllerPath && existsSync(controllerPath)) {
      const source = readFileSync(controllerPath, 'utf8')
      if (!source.includes(screen.viewExport)) errors.push(`${label}: controllerが${screen.viewExport}を使っていません`)
    }

    for (const legacyFile of screen.legacyFiles ?? []) {
      if (existsSync(inside(webRoot, legacyFile))) errors.push(`${label}: 旧表示ファイル ${legacyFile} が残っています`)
    }
    for (const legacyRoute of screen.legacyRoutes ?? []) {
      const routePath = `src/app/${legacyRoute.replace(/^\//, '')}/page.tsx`
      if (existsSync(inside(webRoot, routePath))) errors.push(`${label}: 旧ルート ${legacyRoute} が残っています`)
    }

    const features = screen.featureParity ?? []
    if (features.length === 0) errors.push(`${label}: 現行機能の棚卸しがありません`)
    const featureIds = new Set()
    for (const feature of features) {
      if (!feature.id || featureIds.has(feature.id)) errors.push(`${label}: 機能IDが無いか重複しています`)
      featureIds.add(feature.id)
      if (!VALID_FEATURE_RESULT.has(feature.result)) errors.push(`${label}/${feature.id}: 機能確認結果が不正です`)
      if (feature.result === 'approved-removal' && !feature.decisionUrl) errors.push(`${label}/${feature.id}: 削除承認の正本URLが必要です`)
      if (feature.result === 'missing' || feature.result === 'pending') warnings.push(`${label}: 未移植「${feature.label}」${feature.note ? ` — ${feature.note}` : ''}`)
    }
    if (screen.productionConnected && ['ready', 'verified'].includes(screen.status)) {
      const unresolved = features.filter((feature) => feature.result === 'missing' || feature.result === 'pending')
      if (unresolved.length > 0) errors.push(`${label}: 本番ルート接続済みなのに未移植機能が${unresolved.length}件あります`)
    }

    if (screen.status === 'verified') {
      if (!Array.isArray(screen.states) || screen.states.length === 0) errors.push(`${label}: 比較対象の状態がありません`)
      for (const state of screen.states ?? []) {
        if (!REAL_NODE_ID.test(state.nodeId ?? '')) errors.push(`${label}/${state.id}: 実ノードIDがありません`)
        for (const key of ['reference1920', 'implementation1920', 'implementation1440']) {
          if (!state[key] || !existsSync(inside(repositoryRoot, state[key]))) errors.push(`${label}/${state.id}: ${key}の画像がありません`)
        }
      }
    }
  }

  return { errors, warnings, registry }
}

export function formatV4Report(result) {
  const lines = []
  for (const warning of result.warnings) lines.push(`[要確認] ${warning}`)
  for (const error of result.errors) lines.push(`[エラー] ${error}`)
  if (result.errors.length === 0) lines.push(`V4構造チェック: OK（${result.registry.screens.length}画面）`)
  return lines.join('\n')
}
