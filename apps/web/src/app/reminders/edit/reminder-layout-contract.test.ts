import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * R17 の再発防止。中くらいの幅で送信時刻の欄が切れないこと。
 *
 * 通知ステップ編集は右 390px 固定の2列だったため、幅 768px では
 * 入力列が潰れて時刻欄が約 57px になっていた。広い幅だけ固定にし、
 * 中くらいの幅では LINE のプレビューを下へ送る。時刻の欄は 96px 以上。
 */

const SCREENS = readFileSync(join(process.cwd(), 'src/app/reminders/edit/issue469-reminder-screens.tsx'), 'utf8')

describe('通知ステップ編集の中幅レイアウト', () => {
  it('右390px固定は広い幅だけに効く', () => {
    // 390px 固定はすべて min-width の外側条件の中にあること。
    // 素で置くと中幅で入力列が潰れる。
    const needle = 'grid-template-columns: minmax(0, 1fr) 390px'
    let from = 0
    let count = 0
    for (;;) {
      const at = SCREENS.indexOf(needle, from)
      if (at < 0) break
      count += 1
      expect(SCREENS.slice(Math.max(0, at - 200), at)).toContain('@media(min-width:')
      from = at + needle.length
    }
    expect(count).toBeGreaterThan(0)
  })

  it('送信時刻の欄は 96px 以上を保つ', () => {
    expect(SCREENS).toContain('min-w-24')
  })
})
