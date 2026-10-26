import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** V8の一覧でも、未送信の結果と日時の意味・日本時間の表示を保つ。 */

const SOURCE = readFileSync(new URL('../../v8/broadcasts/list.tsx', import.meta.url), 'utf8')

describe('V8 一斉配信の結果と日時', () => {

  /* 送っていない行の結果を — にし 0 を作らない動きは v8/broadcasts/list.test.tsx「結果の列」が画面を描いて確かめる。 */

  /**
   * 日時は JST で書く。
   *
   * `timeZone` を渡さないと動かしている端末の時計で書き出す。開発機が
   * UTC+7 なので、9時予約が7時と出て、日をまたぐと日付までずれる。
   */
  it('配信日時は Asia/Tokyo で書き出す', () => {
    expect(SOURCE).toContain('<ListDateTime value={broadcast.sentAt} />')
    expect(SOURCE).toContain('<ListDateTime value={broadcast.scheduledAt} />')
  })

  /** 取れない日時に `-` ではなく、理由の読める言葉を出す。 */
  it('日時が無い配信は「未設定」と出す', () => {
    expect(SOURCE).toContain("emptyValue('unconfigured')")
  })
})
