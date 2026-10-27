import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'broadcast-form.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, '..', '..', 'v8', 'broadcast-detail', 'detail.tsx'), 'utf8')

/** 始まりと終わりの目印の間だけを切り出す。ファイル全体を見ると素通しになる。 */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from)
  if (start < 0) throw new Error(`${from} が見つかりません`)
  const end = src.indexOf(to, start + from.length)
  if (end < 0) throw new Error(`${to} が見つかりません`)
  return src.slice(start, end)
}

/**
 * 送信済み詳細の「同じ設定で作り直す」の禁止の見張り。
 *
 * 要件 管理画面-06 §3 は同じ設定からの作成、§10 は `準備中` ボタンを禁じる。
 * 押せる「複製して作る」は v8/broadcast-detail/detail.test.tsx が、
 * 元配信を読んで題名と本文だけを引き継ぐ動き・読めないときの理由は
 * broadcast-form-duplicate-react.test.tsx が画面を動かして見る。
 */
describe('同じ設定で作り直す', () => {
  it('詳細に準備中のままの作り直しを置かない', () => {
    expect(DETAIL, '押せない作り直しが残っている').not.toContain('作り直しは準備中')
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
})
