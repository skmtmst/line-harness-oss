import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FORM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form.tsx'),
  'utf8',
)

describe('一斉配信の画素比較対象', () => {
  it('テンプレート選択は設計の確認項目だけをダイアログへ置く', () => {
    expect(FORM).toContain("[data-design-node='p97Tf']")
    expect(FORM).toContain('このテンプレートの内容を確認しました')
    expect(FORM).not.toContain('selectedTemplate?.messageContent}</dd>')
  })

  it('テスト送信先を選ぶ意味と操作名を設計にそろえる', () => {
    expect(FORM).toContain('title="テスト送信先を選択"')
    expect(FORM).toContain('confirmLabel={testSending ? \'送信中…\' : \'テスト送信する\'}')
    expect(FORM).toContain('cancelLabel="キャンセル"')
    expect(FORM).toContain("[data-design-node='h0kahp']")
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
})
