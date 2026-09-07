/*
 * 対応が必要な受信で、**読めなかったのか 0件なのか**を分ける。
 *
 * 取れていないのに「返信を待っている問い合わせはありません。」と出すと、
 * 通信障害・500 のときに未対応があるのか無いのか区別できず、
 * 返信漏れにつながる。取れていないときは読み直しを出す。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CARD = readFileSync(join(HERE, 'pending-inbox-card.tsx'), 'utf8')

/** 説明の文だけで通ってしまわないよう、判定の前にコメントを落とす。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('対応が必要な受信の読込失敗', () => {
  it('失敗を別の状態として持ち、「なし」と言い切らない', () => {
    const body = code(CARD)
    expect(body).toContain('const [loadFailed, setLoadFailed]')
    expect(body).toContain('setLoadFailed(true)')
    expect(body).toContain('setLoadFailed(false)')
    // 「なし」の文の前に、失敗の枝があること。
    const empty = body.indexOf('返信を待っている問い合わせはありません')
    expect(empty).toBeGreaterThan(-1)
    const before = body.slice(0, empty)
    expect(before.lastIndexOf('loadFailed')).toBeGreaterThan(-1)
  })

  it('取れていないときは読み直しを出し、再試行は既存の読込を呼ぶだけ', () => {
    const body = code(CARD)
    expect(body).toContain('データを取得できませんでした。')
    expect(body).toContain('もう一度読み込む')
    expect(body).toContain('onClick={() => void load()}')
  })
})
