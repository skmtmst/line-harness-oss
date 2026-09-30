#!/usr/bin/env node
/*
 * V8 移行の台帳（V8 移行②）。
 *
 *   node apps/web/scripts/theme-migration-report.mjs [--json]
 *
 * 出すもの:
 *   1. 部品ごとの状態 —— v8対応済み / v7 のまま / 未作成
 *      「v8対応済み」は、部品のコード（.tsx と同じ名前の .module.css）の中に
 *      `[data-theme="v8"]` の指定があること。v8 用の見た目を部品自身が
 *      持っている印で、値だけ globals.css にある段階ではまだ v7 のまま。
 *   2. 画面ごとの状態 —— その画面が直接 import している部品が全部
 *      「v8対応済み」なら v8対応済み、1つでも v7 のままなら v7 のまま。
 *      共通部品を1つも使っていない画面は「部品なし」として別に数える。
 *
 * 部品の対象表は design/v8-parts.json（正本は lh-work/design/v8/COMPONENT-MAP.md）。
 * ⑥で「v7 のまま」が 0 になったら v7 の値を消せる、という進捗計。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allFiles, createImportIndex } from './design-impact.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(WEB, 'src')
const COMPONENTS = join(SRC, 'components')
const MANIFEST = join(WEB, 'design', 'v8-parts.json')

const V8_SELECTOR = /\[data-theme=["']?v8["']?\]/

/** 部品を構成する実ファイル（コード + 同名の CSS Module／素の .css）を返す。 */
function partFiles(codePaths) {
  const files = []
  for (const rel of codePaths) {
    const full = join(COMPONENTS, rel)
    if (!existsSync(full)) continue
    files.push(full)
    for (const css of [full.replace(/\.tsx?$/, '.module.css'), full.replace(/\.tsx?$/, '.css')]) {
      if (existsSync(css)) files.push(css)
    }
  }
  return files
}

export function collectReport() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  /*
   * `v8In: "globals"` の部品（骨格の行など、Tailwind 直書きで
   * CSS Module を持たないもの）は globals.css 側に v8 規定を置く。
   * `v8Selector` で指す規定が globals に実際にあるときだけ v8対応済み
   * と数える（書き忘れ・消し忘れは v7 のままと出る）。
   */
  const globals = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8')
  const globalsHasV8 = (selector) =>
    new RegExp(`\\[data-theme=["']?v8["']?\\][^{]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(globals)
  const parts = manifest.parts.map((part) => {
    const codePaths = part.code ? [part.code].flat() : []
    const files = partFiles(codePaths)
    const v8Files = files.filter((f) => V8_SELECTOR.test(readFileSync(f, 'utf8')))
    const inGlobals = part.v8In === 'globals' && typeof part.v8Selector === 'string' && globalsHasV8(part.v8Selector)
    return {
      name: part.name,
      pencil: part.pencil,
      files,
      v8Files,
      // `v8Same: true` は「V8 と値が同じで上書きが要らない」部品（例: 入力欄）。
      // `v8Only: true` は V8 で新たに生えた部品（削除ボタン・色を選ぶなど）で、
      // V7 の見た目が存在しないためテーマ規定を分けないもの。
      status:
        codePaths.length === 0
          ? '未作成'
          : files.length === 0
            ? 'コード不明'
            : v8Files.length > 0 || part.v8Same === true || part.v8Only === true || inGlobals
              ? 'v8対応済み'
              : 'v7 のまま',
    }
  })

  const readyFiles = new Set(parts.flatMap((p) => (p.status === 'v8対応済み' ? p.files.filter((f) => f.endsWith('.tsx')) : [])))
  const partFileSet = new Set(parts.flatMap((p) => p.files.filter((f) => f.endsWith('.tsx'))))

  const files = allFiles()
  const index = createImportIndex(files)
  const pages = files.filter((f) => /(^|\/)page\.tsx$/.test(relative(join(SRC, 'app'), f)))

  const screens = pages.map((page) => {
    const used = (index.get(page) ?? []).filter((dep) => partFileSet.has(dep))
    const pending = used.filter((dep) => !readyFiles.has(dep))
    return {
      route: `/${relative(join(SRC, 'app'), page).replace(/(^|\/)page\.tsx$/, '')}`.replace(/\/+$/, '') || '/',
      parts: used.length,
      status: used.length === 0 ? '部品なし' : pending.length === 0 ? 'v8対応済み' : 'v7 のまま',
      pending: pending.map((f) => relative(SRC, f)),
    }
  })

  return { parts, screens }
}

function main() {
  const { parts, screens } = collectReport()

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ parts: parts.map(({ name, status }) => ({ name, status })), screens }, null, 2))
    return
  }

  const count = (list, status) => list.filter((x) => x.status === status).length
  console.log('V8 移行の台帳（コードから数えた実測値）\n')
  console.log(`部品: ${parts.length} 件 —— v8対応済み ${count(parts, 'v8対応済み')} / v7 のまま ${count(parts, 'v7 のまま')} / 未作成 ${count(parts, '未作成')}`)
  console.log(`画面: ${screens.length} 件 —— v8対応済み ${count(screens, 'v8対応済み')} / v7 のまま ${count(screens, 'v7 のまま')} / 部品なし ${count(screens, '部品なし')}\n`)

  console.log('| 部品 | 状態 |')
  console.log('|---|---|')
  for (const p of parts) console.log(`| ${p.name} | ${p.status} |`)

  console.log('\n| 画面 | 状態 | 残っている部品 |')
  console.log('|---|---|---|')
  for (const s of screens.sort((a, b) => a.route.localeCompare(b.route))) {
    console.log(`| ${s.route} | ${s.status} | ${s.pending.join('・')} |`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
