import { describe, expect, it } from 'vitest'
import { readTemplateText } from './template-message-text'

describe('文字テンプレートの本文', () => {
  const body = '  {{name}}さん\nご予約ありがとうございます。\n{{var.company_name}}  '
  it('古いJSONから改行・差し込み・前後の空白を残して本文を読む', () => {
    expect(readTemplateText(JSON.stringify({ type: 'text', text: body }))).toBe(body)
  })
  it('新しい本文は改行と差し込みをそのまま残す', () => {
    expect(readTemplateText(body)).toBe(body)
  })
  it('抜粋せず、長い本文と末尾の差し込みを残す', () => {
    const long = `${'長い本文。'.repeat(200)}{{name}}`
    expect(readTemplateText(JSON.stringify({ text: long }))).toBe(long)
  })
  it.each(['{文章の括弧}', '{"text":', '{"text":3}', '{"originalContentUrl":"https://example.invalid/a.png"}', '[{"text":"複数"}]', 'C:\\new\\notice', ''])('文字の保存形式でない値を推測して変えない: %s', value => {
    expect(readTemplateText(value)).toBe(value)
  })
  it('空の本文も空のまま読む', () => {
    expect(readTemplateText('{"text":""}')).toBe('')
  })
})
