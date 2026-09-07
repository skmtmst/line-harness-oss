import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(path.join(__dirname, 'campaign-editor.tsx'), 'utf8')

describe('V6 NEN配信編集の運用者向け文言契約', () => {
  it('きっかけの内部値を画面へ出さない', () => {
    expect(EDITOR).toContain("'ec.order.confirmed': '注文を受け付けたとき'")
    expect(EDITOR).toContain("'ec.order.shipped': '商品を発送したとき'")
    expect(EDITOR).toContain("'ec.order.delivered': '注文が届いたとき'")
    expect(EDITOR).toContain('{triggerLabel(setting)}')
    expect(EDITOR).not.toContain("{setting.triggerEvent ?? '手動で送る'}")
  })

  it('誕生日配信で使われない日数・時刻入力を見せず、実際の固定日時を案内する', () => {
    expect(EDITOR).toContain("setting.campaignKey === 'birthday_coupon'")
    expect(EDITOR).toContain('誕生日の3日前')
    expect(EDITOR).toContain('10:00（固定）')
    expect(EDITOR).toContain('この日時は誕生日配信の実行処理で固定されています。')
    expect(EDITOR).toContain('const timing = isBirthday')
    expect(EDITOR).toContain('{timing}')
  })

  it('画面名をNEN配信にそろえ、内部エラーを表示しない', () => {
    /*
     * **画面名は上部バーだけが持つ。**
     * 以前は本文にも `<Header title="NEN配信を編集する">` を出しており、
     * 上部バーと二重だった。設計（Pencil）の本文に画面名テキストは無い。
     * 上部バーへ渡す `usePageTitle` に替えたので、名前はここで見張る。
     */
    expect(EDITOR).toContain("usePageTitle(`${setting?.label ?? 'NEN配信'}を編集する`)")
    expect(EDITOR).not.toContain('Header title=')
    expect(EDITOR).toContain('href="/nen-campaigns"')
    expect(EDITOR).not.toContain('フォロー配信へ戻る')
    expect(EDITOR).not.toContain('setError(e instanceof Error ? e.message')
  })

  it('本文エディタと回答フォーム・200マイルの送信後アクションを表示して保存する', () => {
    expect(EDITOR).toContain('InsertToolbar')
    expect(EDITOR).toContain('吹き出しを追加する（あと2つまで）')
    expect(EDITOR).toContain('回答フォーム「{formAction.formName}」を開く')
    expect(EDITOR).toContain("{ kind: 'award_mileage', amount: 200, trigger: 'form_submitted' }")
    expect(EDITOR).toContain('afterActions: actions')
    expect(EDITOR).toContain('配信内容を保存')
  })
})
