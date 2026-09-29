import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * N-283: 「段の作り方」の案内が実際に選べる段の種類と一致することを、
 * 正本（packages/db/src/analytics-funnels.ts の V6_FUNNEL_STEP_KINDS）へ
 * 機械照合する契約試験。
 *
 * 画面側は FUNNEL_STEP_KIND_OPTIONS が選択肢と案内文の両方の元になっている。
 * 正本に種類が増えて画面側へ反映し忘れたとき、この試験が先に落ちる。
 */
const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const FUNNELS_DB = readFileSync(
  new URL('../../../../../packages/db/src/analytics-funnels.ts', import.meta.url),
  'utf8',
)

const canonicalKinds = (() => {
  const block = FUNNELS_DB.match(/V6_FUNNEL_STEP_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!block) throw new Error('V6_FUNNEL_STEP_KINDS が見つかりません')
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
})()

const optionBlock = (() => {
  const block = PAGE.match(/FUNNEL_STEP_KIND_OPTIONS\s*=\s*\[([\s\S]*?)\n\]/)
  if (!block) throw new Error('FUNNEL_STEP_KIND_OPTIONS が見つかりません')
  return block[1]
})()

const optionKeys = [...optionBlock.matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1])
const optionLabels = [...optionBlock.matchAll(/label:\s*'([^']+)'/g)].map((match) => match[1])

describe('ファネルの段の種類', () => {
  it('作成フォームの選択肢は正本の全種類と一致する', () => {
    expect(optionKeys.length).toBeGreaterThan(0)
    expect([...optionKeys].sort()).toEqual([...canonicalKinds].sort())
    // 正本のどの種類も案内へ出す文言（ラベル）を持つ。
    expect(optionLabels).toHaveLength(canonicalKinds.length)
  })

  it('「段の作り方」の案内は選択肢の一覧から作る（古い5種の固定文を残さない）', () => {
    expect(PAGE).toContain(
      "段には {FUNNEL_STEP_KIND_OPTIONS.map((item) => item.label).join('・')} を置けます",
    )
    expect(PAGE).not.toContain('タグ・友だち情報・フォーム回答・サイトの行動・購入')
  })

  it('段の選択セレクトと案内は同じ一覧を使う', () => {
    expect(PAGE).toContain('options={FUNNEL_STEP_KIND_OPTIONS.map(')
  })
})
