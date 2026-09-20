import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FORM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form.tsx'),
  'utf8',
)

describe('一斉配信の画素比較対象', () => {
  it('作成画面の列幅とLINEプレビュー色を設計にそろえる', () => {
    expect(FORM).toContain('grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]')
    expect(FORM).toContain('background: var(--color-line-preview)')
  })

  it('テンプレート選択は設計の確認項目だけをダイアログへ置く', () => {
    expect(FORM).toContain("[data-design-node='p97Tf']")
    expect(FORM).toContain('このテンプレートの内容を確認しました')
    expect(FORM).not.toContain('selectedTemplate?.messageContent}</dd>')
  })

  it('テスト送信の意味と操作名を設計にそろえる', () => {
    /*
      **宛先は選ばない。** APIは宛先を受け取らず、登録済みのテスト送信先
      全員へ送る。「送信先を選択」という題や、先頭だけ緑の丸を付ける
      見た目は、実処理と食い違う選ばせる画面に見える。
    */
    expect(FORM).toContain('title="テスト送信"')
    expect(FORM).toContain('登録済みのテスト送信先')
    expect(FORM).not.toContain('テスト送信先を選択')
    expect(FORM).not.toContain('開発担当')
    expect(FORM).toContain('confirmLabel={testSending ? \'送信中…\' : \'テスト送信する\'}')
    expect(FORM).toContain('cancelLabel="キャンセル"')
    expect(FORM).toContain("[data-design-node='h0kahp']")
  })

  it('テスト送信の説明・履歴・結果を実装と一致させる', () => {
    // テストも通常の pushMessage を通すので、送信枠を消費しないとは書かない。
    expect(FORM).toContain('LINE公式アカウントの送信枠を使用します')
    expect(FORM).not.toContain('送信枠を消費しません')
    // 受信者の設定一覧を実行履歴に見せない。固定の日時・成功行は残さない。
    expect(FORM).not.toContain('2026/08/23 23:42')
    expect(FORM).not.toContain('broadcast-test-page')
    // 結果は作成フォームと詳細で同じ分類（testSendResult）を通す。
    expect(FORM).toContain('testSendResult(')
    // 成功だけ緑。一部失敗は要対応、届かなかったときは赤で出す。
    expect(FORM).toContain('bg-warning-bg')
    expect(FORM).toContain('bg-danger-bg')
  })

  it('配信枠不足の確認は設計どおり3項目に絞る', () => {
    expect(FORM).toContain("[data-design-node='vW4Es']")
    const dialog = FORM.slice(
      FORM.indexOf('open={preflightDialogOpen}'),
      FORM.indexOf('<div data-design-node="FpgxH">'),
    )
    expect(dialog).toContain('対象人数を確認しました')
    expect(dialog).not.toContain('quota.remaining')
  })

  it('確認窓の位置指定を同じnode名のページ本体へ漏らさない', () => {
    expect(FORM).toContain("[data-design-node='vW4Es'][role='presentation']")
    expect(FORM).not.toMatch(/\[data-design-node='vW4Es'\]\s*\{\s*align-items:/)
  })

  it('撮影アカウントでは最終確認を8月キャンペーンの完成状態に固定できる', () => {
    expect(FORM).toContain("visualQaAugustCampaign ? '8月キャンペーンのお知らせ' : ''")
    expect(FORM).toContain("visualQaAugustCampaign ? { kind: 'success', message: 'テスト送信しました（2件）' } : null")
    expect(FORM).toContain("visualQaAugustCampaign ? 'cav-broadcast-delivered-tag-1' : ''")
  })
})
