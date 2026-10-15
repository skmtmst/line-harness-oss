import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(path.join(__dirname, '../../../v8/nen-campaigns/edit.tsx'), 'utf8')
const DISPLAY = fs.readFileSync(path.join(__dirname, '../../../v8/nen-campaigns/display.ts'), 'utf8')

describe('V8 NEN配信編集の運用者向け文言契約', () => {
  it('きっかけの内部値を画面へ出さない', () => {
    expect(EDITOR).toContain("'ec.order.confirmed': '注文を受け付けた'")
    expect(EDITOR).toContain("'ec.order.shipped': '商品を発送した'")
    expect(EDITOR).toContain("'ec.order.delivered': '注文が届いた'")
    expect(EDITOR).toContain('const trigger = triggerShort(setting)')
    expect(EDITOR).toContain('{trigger}</li>')
    expect(EDITOR).not.toContain("{setting.triggerEvent ?? '手動で送る'}")
  })

  it('誕生日配信で使われない日数・時刻入力を見せず、実際の固定日時を案内する', () => {
    // 固定の誕生日と、設定値を使う発送起点を共通の表示で分ける。
    expect(EDITOR).toContain("merged.campaignKey === 'birthday_coupon'")
    expect(EDITOR).toContain('10:00（固定）')
    expect(EDITOR).toContain('誕生日のきっかけ・日時は配信の実行処理で固定されています。')
    expect(EDITOR).toContain('const timing = `${formatCampaignTiming')
    expect(EDITOR).toContain('caption={timing}')
    expect(DISPLAY).toContain("birthday_coupon: '誕生日の3日前 10:00'")
  })

  it('画面名をNEN配信にそろえ、内部エラーを表示しない', () => {
    // 現役の共通画面の見出しと、一覧へ戻る操作を見張る。
    expect(EDITOR).toContain('title={`${setting.label}（配信を直す）`}')
    expect(EDITOR).not.toContain('Header title=')
    expect(EDITOR).toContain('href="/nen-campaigns"')
    expect(EDITOR).not.toContain('フォロー配信へ戻る')
    expect(EDITOR).not.toContain('setError(e instanceof Error ? e.message')
  })

  it('本文エディタと回答フォーム・200マイルの送信後アクションを表示して保存する', () => {
    expect(EDITOR).toContain('InsertToolbar')
    /*
     * NEXT-16 (#989): 複数吹き出しはWorkerの保存スキーマに口がない。
     * 無反応の「差し替える」「消す」「吹き出しを追加する」は出さず、
     * 1通で届くことを明示する。
     */
    expect(EDITOR).not.toContain('吹き出しを追加する')
    expect(EDITOR).not.toContain('<Button>差し替える</Button>')
    expect(EDITOR).toContain('この配信は1通で届きます')
    expect(EDITOR).toContain('回答フォームを開かせる <OptionalBadge />')
    expect(EDITOR).toContain('value={formAction?.formId')
    expect(EDITOR).toContain('const MILEAGE_CHOICES = [50, 100, 200, 300, 500, 1000]')
    expect(EDITOR).toContain("{ kind: 'award_mileage', amount: Number(value), trigger: 'form_submitted' }")
    expect(EDITOR).toContain('afterActions: actions')
    expect(EDITOR).toContain('配信内容を保存する')
  })
})
