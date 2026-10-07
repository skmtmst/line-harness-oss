import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 配る画像の重さの見張り（リリース前点検 2026-10-07）。
 *
 * public の png・jpg は 100KB を超えたら webp（cwebp -q 80）にして参照も直す。
 * お客さまが上げる画像はサーバー側の話なので、ここでは見ない。
 */
const PUBLIC = path.join(__dirname, '..', '..', 'public')
const LIMIT = 100 * 1024

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('配る画像の重さ', () => {
  it('public の png・jpg は 100KB 以下（大きいものは webp に）', () => {
    const heavy = walk(PUBLIC)
      .filter((f) => /\.(png|jpe?g)$/i.test(f) && fs.statSync(f).size > LIMIT)
      .map((f) => path.relative(PUBLIC, f))
    expect(heavy).toEqual([])
  })

  it('接続マニュアルの画像の参照は、置いてある webp を指す', () => {
    const dir = path.join(PUBLIC, 'manuals', 'line-connect')
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
    const refs = [...html.matchAll(/src="\/manuals\/line-connect\/(images\/[^"]+)"/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(ref, ref).toMatch(/\.webp$/)
      expect(fs.existsSync(path.join(dir, ref)), ref).toBe(true)
    }
  })
})
