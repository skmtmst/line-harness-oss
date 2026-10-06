import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * V8 の画面（src/v8）を一から書く決まりの見張り（2026-10-06 オーナー決定）。
 * 古い画面ファイルを持ち込まない・v7 と分けない・CSS に数字を直書きしない。
 */
const ROOT = __dirname
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const all = files(ROOT).filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
const code = all.filter((f) => /\.(tsx?|jsx?)$/.test(f))
const css = all.filter((f) => f.endsWith('.css'))

describe('V8 の画面（src/v8）の決まり', () => {
  it('古い画面ファイル（src/app）を import しない', () => {
    const bad = code.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1])
        .filter((s) => s.startsWith('@/app/') || /(^|\/)\.\.\/(\.\.\/)*app\//.test(s))
        .map((s) => `${relative(ROOT, f)} → ${s}`),
    )
    expect(bad).toEqual([])
  })

  it('v7 と v8 を画面の中で分けない（分けるのは入口の page.tsx）', () => {
    const bad = code.filter((f) => /useAdminTheme|data-theme=|theme\s*===?\s*['"]v7['"]/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))
    expect(bad).toEqual([])
  })

  it('CSS に数字を直書きしない（0 と 1px の線だけ可）', () => {
    const bad = css.flatMap((f) => {
      const body = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      return [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)]
        .filter(([, prop, value]) => !prop.startsWith('--'))
        .filter(([, , value]) => /(^|[\s(,])(?!0px|1px)\d+(\.\d+)?(px|rem|em)\b|#[0-9a-fA-F]{3,8}\b/.test(value))
        .map(([line]) => `${relative(ROOT, f)}: ${line.trim()}`)
    })
    expect(bad).toEqual([])
  })
})
