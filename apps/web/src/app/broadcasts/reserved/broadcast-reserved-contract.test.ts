import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/broadcasts/reserved/page.tsx'), 'utf8')
const FORM = readFileSync(join(process.cwd(), 'src/components/broadcasts/broadcast-form.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(process.cwd(), 'src/app/broadcasts/new/page.tsx'), 'utf8')

describe('V6 一斉配信の予約完了', () => {
  it('作成結果の実IDを完了画面へ渡す', () => {
    expect(FORM).toContain('const saved = await persistDraft(scheduledAtIso())')
    expect(FORM).toContain('onSuccess(saved)')
    expect(NEW_PAGE).toContain('/broadcasts/reserved?id=')
    expect(NEW_PAGE).toContain("broadcast.status === 'scheduled'")
  })

  it('テスト送信と最終予約は同じ下書きを更新する', () => {
    expect(FORM).toContain('const draft = await persistDraft(null)')
    expect(FORM).toContain('api.broadcasts.testSend(draft.id)')
    expect(FORM).not.toContain('idempotencyKey: crypto.randomUUID()')
  })

  it('保存した配信を読み直し予約状態を確かめる', () => {
    expect(PAGE).toContain('api.broadcasts.get(id)')
    expect(PAGE).toContain("broadcast.status !== 'scheduled'")
    expect(PAGE).toContain('!broadcast.scheduledAt')
  })

  it('予約人数を保存値や固定値で作らず現在の見込みとして表示する', () => {
    expect(PAGE).toContain('api.broadcasts.preflight')
    expect(PAGE).toContain('estimate?.audienceCount ?? null')
    expect(PAGE).toContain('現在の配信見込み')
    expect(PAGE).not.toContain('totalCount')
  })

  it('未取得と実値0を分ける', () => {
    expect(PAGE).toContain('estimate?.hiddenExcluded ?? null')
    expect(PAGE).toContain('現在の人数を確認できませんでした')
    expect(PAGE).toContain('現在の除外人数を確認できませんでした')
    expect(PAGE).toContain('人数だけ取れないときに予約そのものまで')
  })

  it('選択中アカウントと所属先が違う配信を表示しない', () => {
    expect(PAGE).toContain('belongsToAccount(broadcast, selectedAccountId)')
    expect(PAGE).toContain('選択中のアカウントの配信ではありません')
  })

  it('送信時に再集計することを明記する', () => {
    expect(PAGE).toContain('送信を始める直前に同じ条件でもう一度数えます')
    expect(PAGE).toContain('現在の見込み')
  })
})
