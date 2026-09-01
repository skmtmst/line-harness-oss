/*
 * 1通目設定（設計 `V6 5 kk8dz`）の契約。
 *
 * 見るのは3つ。
 *   1. 下見が「配信の流れ」1枚で、実際に届く吹き出しを出していること
 *   2. 設計の言葉づかい（「この1通目を誰に送るか」「1通目の内容」）
 *   3. 上限を超えた本文のまま保存を押せないこと
 *
 * 3つ目が本体。押せたところでLINEが弾くので、画面は「保存できたのに届かない」
 * を作ることになる。
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const COMPONENTS = path.join(__dirname, '..', '..', '..', 'components', 'scenarios')
const PREVIEW = fs.readFileSync(path.join(COMPONENTS, 'step-preview.tsx'), 'utf8')
const TABS = fs.readFileSync(path.join(COMPONENTS, 'message-type-tabs.tsx'), 'utf8')
/*
 * 設計固有の実寸はCSSモジュールへ置いてある。任意値記法で散らすと
 * `design-debt` の数が増え、どれが設計の数かも区別できなくなる。
 */
const PAGE_CSS = fs.readFileSync(path.join(__dirname, 'first-step.module.css'), 'utf8')
const PREVIEW_CSS = fs.readFileSync(path.join(COMPONENTS, 'step-preview.module.css'), 'utf8')
const TABS_CSS = fs.readFileSync(path.join(COMPONENTS, 'message-type-tabs.module.css'), 'utf8')

describe('V6 1通目設定の契約', () => {
  it('設計Node IDを画面に残す', () => {
    expect(PAGE).toContain('data-design-node="kk8dz"')
  })

  it('段の見出しを設計の言葉にする', () => {
    expect(PAGE).toContain('この1通目を誰に送るか')
    expect(PAGE).toContain('1通目の内容')
    expect(PAGE).not.toContain('>配信対象の絞り込み</h2>')
  })

  it('下見は「配信の流れ」1枚にまとめる', () => {
    expect(PREVIEW).toContain('配信の流れ')
    expect(PREVIEW).not.toContain('いつ届くか</h3>')
    expect(PREVIEW).not.toContain('何が届くか</h3>')
  })

  it('下見の外枠は設計の幅500・角丸10', () => {
    expect(PREVIEW_CSS).toMatch(/\.preview \{[^}]*max-width: 500px;[^}]*border-radius: 10px;/)
    expect(PREVIEW).toContain('styles.preview')
    expect(PAGE).toContain('xl:grid-cols-[minmax(0,1fr)_500px]')
  })

  it('届く日時は縦の線ではなく26pxの帯で出す', () => {
    expect(PREVIEW_CSS).toMatch(/\.band \{[^}]*height: 26px;/)
    expect(PREVIEW).toContain('styles.band')
    expect(PREVIEW).toContain('text-micro font-semibold')
    expect(PREVIEW).toContain('size={13}')
  })

  it('吹き出しは左下だけ角を落とし、本文は13px', () => {
    expect(PREVIEW_CSS).toMatch(/\.bubble \{[^}]*border-radius: 14px 14px 14px 4px;/)
    expect(PREVIEW).toContain('styles.bubble')
    expect(PREVIEW).toContain('text-label leading-relaxed font-medium')
  })

  it('種別タブは外枠38・タブ30の帯にする', () => {
    expect(TABS_CSS).toMatch(/\.rail \{[^}]*min-height: 38px;[^}]*border-radius: 8px;/)
    expect(TABS_CSS).toMatch(/\.tab \{[^}]*height: 30px;[^}]*border-radius: 6px;/)
    expect(TABS).toContain('styles.rail')
    expect(TABS).toContain('${styles.tab} px-3 text-micro font-bold')
    expect(TABS).not.toContain('rounded-t-control')
  })

  it('本文の高さと、日数・時刻の幅を設計に合わせる', () => {
    expect(PAGE_CSS).toMatch(/\.bodyField \{[^}]*height: 118px;/)
    expect(PAGE_CSS).toMatch(/\.smallField \{[^}]*height: 38px;[^}]*width: 110px;/)
    expect(PAGE_CSS).toMatch(/\.timeField \{[^}]*height: 38px;[^}]*width: 130px;/)
    expect(PAGE).toContain('styles.bodyField')
    expect(PAGE).toContain('styles.smallField')
    expect(PAGE).toContain('styles.timeField')
    expect(PAGE).not.toContain('w-20 border px-3 py-2 text-sm')
  })

  it('本文の文字数を出す', () => {
    expect(PAGE).toContain('<CharCounter length={body.length} />')
  })

  it('上限を超えた本文では保存を押せなくし、理由を本文に出す', () => {
    expect(PAGE).toContain('const bodyOverLimit =')
    expect(PAGE).toContain('isOverCharLimit(body.length, LINE_TEXT_LIMIT)')
    expect(PAGE).toContain('disabled={saving || bodyOverLimit}')
    expect(PAGE).toContain('LINEが受け付けないため、この状態では保存できません。')
  })
})
