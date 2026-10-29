import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error 構文点検は素のJavaScriptの入口を使う。
import { addedHonorifics, directHonorifics } from './honorific-audit.mjs'

const root = join(__dirname, '../..')
describe('顧客名の敬称の手書きを増やさない', () => {
  it.each([
    ['apps/web/src/components/shared/example.tsx', 'export const P = () => <p>{name}さんの詳細</p>'],
    ['apps/web/src/components/scenarios/example.tsx', 'export const P = () => <p>{friendName}様へ</p>'],
    ['apps/web/src/components/shared/example.tsx', 'export const P = () => <p>{name}{"さん"}</p>'],
    ['apps/web/src/components/shared/example.tsx', 'export const P = () => <p>{name}{" "}さん</p>'],
    ['apps/web/src/components/shared/example.tsx', 'export const P = () => <p>{friendName} {" "}{"様"}</p>'],
    ['apps/web/src/v8/example/model.ts', 'export const message = `${customerName}${"さん"}`'],
    ['apps/web/src/v8/example/model.ts', 'export const message = `${customerName} さまの予約`'],
    ['apps/liff/src/pages/example.tsx', 'export const P = () => <p>{customer.display_name}さん</p>'],
    ['apps/web/src/v8/example/model.ts', 'export const message = friendName + "さんへ"'],
    ['apps/web/src/v8/example/model.ts', 'export const message = name + `さん`'],
    ['apps/web/src/v8/example/model.ts', 'export const message = name + ("様")'],
    ['apps/liff/src/pages/example.jsx', 'export const P = () => <p>{name}さん</p>'],
    ['apps/liff/src/pages/example.jsx', 'export const P = () => <p>{nickname}さん</p>'],
    ['apps/liff/src/pages/example.js', 'export const message = name + "さま"'],
    ['apps/web/src/v8/example/model.ts', 'export const message = `送信先「${friendName}」さん`'],
  ])('%sの手書きを検出し、共有関数へ戻すと通る', (file, broken) => {
    const healthy = 'export const label = withHonorific(friendName)'
    const before = directHonorifics({ file, source: healthy })
    expect(addedHonorifics(before, directHonorifics({ file, source: broken }))).toHaveLength(1)
    expect(addedHonorifics(before, directHonorifics({ file, source: healthy }))).toEqual([])
  })

  it('コメントと差し込み文の見本は対象にせず、行移動は許し複製は検出する', () => {
    const file = '__fixture__/apps/web/src/v8/example/model.ts'
    const source = 'export const label = `${friendName}さん`'
    const before = directHonorifics({ file, source })
    expect(directHonorifics({ file, source: '// `${friendName}さん`\nexport const sample = "{{name}}さん"' })).toEqual([])
    expect(addedHonorifics(before, directHonorifics({ file, source: `\n${source}` }))).toEqual([])
    expect(addedHonorifics(before, directHonorifics({ file, source: `${source}\n${source}` }))).toHaveLength(1)
  })

  it('Webの入口・共通部品・画面とLIFFのts/tsxで、土台より手書きを増やさない', () => {
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const base = process.env.HONORIFIC_BASE_SHA || git(['merge-base', 'HEAD', 'origin/codex/development']).trim()
    const files = execFileSync('rg', ['--files', 'apps/web/src', 'apps/liff/src', '-g', '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', '-g', '!*.test.*', '-g', '!*.spec.*', '-g', '!*.d.ts'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
    const baseFiles = new Set(git(['ls-tree', '-r', '--name-only', base]).trim().split('\n'))
    const findings = files.flatMap(file => {
      const after = directHonorifics({ file, source: readFileSync(join(root, file), 'utf8') })
      if (!after.length) return []
      const before = baseFiles.has(file) ? directHonorifics({ file, source: git(['show', `${base}:${file}`]) }) : []
      return addedHonorifics(before, after)
    })
    expect(findings).toEqual([])
  })
})
