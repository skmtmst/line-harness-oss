import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/*
 * 影の無いカード（線だけの箱・平らな地の箱）を増やさない（2026-10-27 オーナー）。
 * カードは白い地に影だけ（決まり）。共通の Card を影の無い形（frame の flat・ring・inset、
 * surface の inset・bordered・muted）で使う所を数え、今の数より増えたら落とす。
 * 直したら下の数を減らす（増やさない）。カードそのものの形を影ありにそろえるのは Card の持ち主（tone）。
 */
const CEILING = 67

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const files: string[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) files.push(p)
  }
}
walk(SRC)
const FLAT = /<Card\b[^>]*?\b(?:frame="(?:flat|ring|inset)"|surface="(?:inset|bordered|muted)")/g

export function countFlatCards(source: string): number {
  return [...source.matchAll(FLAT)].length
}

it('影の無いカードの数を今より増やさない', () => {
  const counts = files.map((p) => [relative(SRC, p), countFlatCards(readFileSync(p, 'utf8'))] as const).filter(([, n]) => n > 0)
  const total = counts.reduce((sum, [, n]) => sum + n, 0)
  expect(total, `影の無いカード ${total} か所（上限 ${CEILING}）：${counts.map(([p, n]) => `${p}=${n}`).join(', ')}`).toBeLessThanOrEqual(CEILING)
})

it('数え方は影の無い形だけを拾う', () => {
  expect(countFlatCards('<Card frame="flat">a</Card><Card surface="muted" padding="compact">b</Card>')).toBe(2)
  expect(countFlatCards('<Card>a</Card><Card variant="aside">b</Card>')).toBe(0)
})
