import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'broadcast-form.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, '..', '..', 'app', 'broadcasts', 'detail', 'page.tsx'), 'utf8')

/** 始まりと終わりの目印の間だけを切り出す。ファイル全体を見ると素通しになる。 */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from)
  if (start < 0) throw new Error(`${from} が見つかりません`)
  const end = src.indexOf(to, start + from.length)
  if (end < 0) throw new Error(`${to} が見つかりません`)
  return src.slice(start, end)
}

/**
 * 送信済み詳細の「同じ設定で作り直す」（#605）。
 *
 * 要件 v6-06 §3 は同じ設定からの作成、§10 は `準備中` ボタンを禁じる。
 * 押すと元配信の題名・本文を引き継いだ新規作成へ進む。
 */
describe('同じ設定で作り直す', () => {
  it('詳細に押せる作り直しがあり、準備中のまま置かない', () => {
    expect(DETAIL).toContain('/broadcasts/new?duplicateFrom=')
    expect(DETAIL).toContain('同じ設定で作り直す')
    expect(DETAIL, '押せない作り直しが残っている').not.toContain('作り直しは準備中')
  })

  it('作り直しは元配信を読んで題名と本文を引き継ぐ', () => {
    expect(FORM).toContain("searchParams.get('duplicateFrom')")
    expect(FORM).toContain('api.broadcasts.get(sourceId)')
    expect(FORM).toContain("setDeliveryMethod('duplicate')")
  })

  it('送信先・予約日時・配信元を引き継がない', () => {
    /*
     * 引き継ぐのは題名と本文だけ。宛先や予約を写すと、確認しないまま
     * 別宛先・別日時に送れる。ここで見張るのは複製の写し部分だけ。
     */
    const copy = between(FORM, '複製で引き継ぐのは題名と本文だけ', 'const duplicateRecent')
    for (const key of ['targetType', 'targetTagId', 'scheduledAt', 'lineAccountId', 'accountIds']) {
      expect(copy, `${key} を引き継いでいる`).not.toContain(key)
    }
    const apply = between(FORM, '送信済み詳細の「同じ設定で作り直す」から来たとき', "setDeliveryMethod('duplicate')")
    for (const key of ['setTargetMode', 'setScheduledDate', 'setScheduledTime']) {
      expect(apply, `${key} で引き継いでいる`).not.toContain(key)
    }
  })

  it('元が読めないときは黙って空にせず理由を出す', () => {
    expect(FORM).toContain('元の配信を読み込めませんでした。作り直す配信を選び直してください。')
  })
})
