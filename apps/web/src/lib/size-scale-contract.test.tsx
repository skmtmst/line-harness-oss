// @vitest-environment happy-dom
/*
 * #704 デザイントークン収束（サイズ系のみ。色は #669 の範囲なので触らない）。
 *
 * 正規の段は globals.css の @theme に定義する:
 *   文字 6段 micro11/caption12/body14/lead16/title20/hero28（★V7 で hero は28）
 *   角丸 4段 mini6/control8/card12/pill9999（★V7 でカード・窓は12に一本化）
 *   余白 5段 4/8/12/16/24（gap-1/2/3/4/6。Tailwind 既定の4px基準を使う）
 *
 * 既存の半端値は M10 polish で同pxトークンへ寄せた（text-[17px]・
 * [26px] 各1だけ v7 側の見た目が変わるため残す）。新規で増やさない
 * ことをここで見張る（ラチェット）。落ちたらトークンか正規段へ寄せ、
 * 減った分だけ基準値を下げる（増やさない）。それでも足りない段があれば、
 * Issue #704 で設計（Pencil）と合わせて決めてから基準値を更新する。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const GLOBALS = readFileSync(join(SRC, 'app/globals.css'), 'utf8')

function token(name: string): string {
  const hit = GLOBALS.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return hit ? hit[1].trim() : '(未定義)'
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.endsWith('.test.tsx') && !name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/** 実際の出現回数を数える。key はクラス名そのまま。 */
function countUsages(pattern: RegExp): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(pattern)) {
      const key = m[0]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/** 基準値を超えた分だけを報告する。未知の値（基準に無い key）は 1つでも落とす。 */
function increased(counts: Map<string, number>, baseline: Record<string, number>): string[] {
  const bad: string[] = []
  for (const [key, n] of [...counts.entries()].sort()) {
    const allowed = baseline[key] ?? 0
    if (n > allowed) bad.push(`${key} が ${n} か所（基準 ${allowed}）。新規はトークンか正規段を使ってください`)
  }
  return bad
}

describe('#704 正規のサイズトークンがある', () => {
  it('文字は正規6段（10/12/14/16/20/28）', () => {
    expect(token('text-nano')).toBe('10px')
    expect(token('text-caption')).toBe('12px')
    expect(token('text-body')).toBe('14px')
    expect(token('text-lead')).toBe('16px')
    expect(token('text-title')).toBe('20px')
    // ★V7「見た目の物差し」§1: 大きな数は 28/700/1.3（#704 の 24px から改定）
    expect(token('text-hero')).toBe('28px')
  })

  it('角丸は正規4段（6/8/12/full）', () => {
    expect(token('radius-mini')).toBe('6px')
    expect(token('radius-control')).toBe('8px')
    // ★V7「見た目の物差し」§1: カード・ダイアログ・知らせは 12px
    expect(token('radius-card')).toBe('12px')
    expect(token('radius-pill')).toBe('9999px')
  })

  it('余白の正規5段（4/8/12/16/24）は gap-1/2/3/4/6 で読む', () => {
    const flat = GLOBALS.replace(/\s+/g, ' ')
    expect(flat).toContain('gap-1 / gap-2 / gap-3 / gap-4 / gap-6')
  })

  it('既存の段を消さない（置き換えは画面ごとに段階的）', () => {
    // 文字: 使う画面があるので残す。11/13px は可読性基準との兼ね合いで
    // 新規には使わず、正規段へ寄せる。
    expect(token('text-micro')).toBe('11px')
    expect(token('text-label')).toBe('13px')
    expect(token('text-heading')).toBe('18px')
    expect(token('text-metric')).toBe('22px')
    expect(token('text-display')).toBe('30px')
    // 角丸: 設計固定テストが値を pin している画面があるので残す。
    expect(token('radius-icon')).toBe('3px')
    expect(token('radius-panel')).toBe('12px')
    expect(token('radius-large')).toBe('18px')
  })
})

describe('#704 半端値を新規で使わない（ラチェット）', () => {
  it('文字サイズの任意値 text-[Npx] を増やさない', () => {
    const counts = countUsages(/text-\[\d+px\]/g)
    expect(
      increased(counts, {
        // M10 polish で同pxトークンへ寄せた分は外す（0は新規1件で落ちる）。
        // 残りは v7 側の見た目が変わるため残す（inbox-kpis・tag-list-v2）。
        'text-[26px]': 1,
        'text-[17px]': 1,
      }),
    ).toEqual([])
  })

  it('角丸の任意値 rounded-[Npx] を増やさない', () => {
    const counts = countUsages(/rounded(?:-(?:t|b|l|r|tl|tr|bl|br))?-\[\d+px\]/g)
    expect(
      increased(counts, {}),
    ).toEqual([])
  })

  it('余白の任意値 gap-[Npx] を増やさない', () => {
    const counts = countUsages(/(?:gap|gap-x|gap-y)-\[\d+px\]/g)
    expect(
      increased(counts, {
        'gap-[7px]': 1,
        'gap-[5px]': 1,
        'gap-[14px]': 1,
        'gap-[13px]': 1,
      }),
    ).toEqual([])
  })

  it('4の倍数でない gap 段（1.5=6px など）を増やさない', () => {
    const counts = countUsages(/(?:gap|gap-x|gap-y)-\d+\.\d+/g)
    expect(
      increased(counts, {
        'gap-1.5': 167,
        'gap-2.5': 23,
        'gap-0.5': 14,
        'gap-3.5': 2,
        'gap-y-1.5': 1,
        'gap-y-0.5': 1,
      }),
    ).toEqual([])
  })
})

/** 正規トークンのクラス名は、実Reactで描画できる綴りと一致する。 */
function TokenProbe() {
  return (
    <div className="flex gap-2 rounded-card bg-canvas p-4">
      <p className="text-body text-ink">本文</p>
      {/* ★V7: 700 は大きな数だけ。text-hero が自分で 700 を持つので font-bold は付けない */}
      <p className="text-hero text-ink">大きな数値</p>
    </div>
  )
}

describe('#704 正規トークンを実Reactで読む', () => {
  it('正規クラスの綴りで描画でき、globals.css の定義と一致する', () => {
    render(<TokenProbe />)
    const body = screen.getByText('本文')
    expect(body.className).toContain('text-body')
    const hero = screen.getByText('大きな数値')
    expect(hero.className).toContain('text-hero')
    const card = hero.parentElement
    expect(card?.className).toContain('rounded-card')
    expect(card?.className).toContain('gap-2')
    // 描画した綴りが、定義されたトークンを指している。
    expect(token('text-body')).toBe('14px')
    expect(token('text-hero')).toBe('28px')
    expect(token('radius-card')).toBe('12px')
  })
})
