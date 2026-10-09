import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 一覧の表が設計 `q76C35`（V6 6-1 一斉配信）の6列であることを見る。
 *
 * **ファイル全体を toContain で見ない。** 一覧の page.tsx には絞り込みや
 * フォルダの語も入っているので、全体を見ると列と関係のない場所に同じ語が
 * あるだけで通ってしまう。`<thead>` と `<tbody>` を切り出して、その中だけを
 * 数える。
 *
 * 実際に、見出しが8つ・中身が7つで1列ずれていたのを、この形の検査が無くて
 * 撮影するまで誰も気づけなかった。
 */

const SOURCE = readFileSync(new URL('../../v8/broadcasts/list.tsx', import.meta.url), 'utf8')

describe('一斉配信の一覧の列（設計 q76C35）', () => {

  /**
   * まだ送っていない配信に `0件` と書かない。
   *
   * 0通届いたのではなく、届く前だから数が無い。単位を付けた 0 は
   * 「送ったが誰にも届かなかった」に読める。
   */
  it('送信済みでない行の結果は — で、数や単位を作らない', () => {
    const stats = SOURCE.slice(SOURCE.indexOf("{broadcast.status !== 'sent' ?"), SOURCE.indexOf("<span className={styles.resultMain}"))
    expect(stats).toContain("broadcast.status !== 'sent'")
    expect(stats).toContain('—')
    expect(stats).not.toMatch(/0\s*件/)
    expect(stats).not.toMatch(/0\s*人/)
  })

  /**
   * 日時は JST で書く。
   *
   * `timeZone` を渡さないと動かしている端末の時計で書き出す。開発機が
   * UTC+7 なので、9時予約が7時と出て、日をまたぐと日付までずれる。
   */
  it('配信日時は Asia/Tokyo で書き出す', () => {
    expect(SOURCE).toContain('polishFormatListDateTime(broadcast.sentAt')
  })

  /** 取れない日時に `-` ではなく、理由の読める言葉を出す。 */
  it('日時が無い配信は「未設定」と出す', () => {
    expect(SOURCE).toContain("'未設定'")
  })
})
