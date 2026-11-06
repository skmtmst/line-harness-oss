import nodeFs from 'node:fs'
import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
const fs = { ...nodeFs, readFileSync: readUiSource }
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * 機能5（シナリオ配信）の複製2操作の再発防止。
 *
 * 動き（後ろをずらしてから足す・時刻・絞り込み・質問・下書き・きっかけ・アクションまで写す・
 * 途中で止まったら作りかけを見せて続きから写す）は v8/scenario-detail/detail-actions.test.tsx が
 * 画面を描いて押して、口へ渡った中身で守る。ここには戻してはいけない書き方の見張りだけを残す。
 */

const DETAIL = fs.readFileSync(path.join(__dirname, 'scenario-detail-client.tsx'), 'utf8')

/** `start` から `end` までの範囲だけを切り出す。見つからなければ失敗する。 */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`切り出しの始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`切り出しの終わりが見つかりません: ${end}`)
  return source.slice(from, to + end.length)
}

describe('R216: 複製で余分な時刻の欄を送らない（経過時間に delayMinutes を混ぜない）', () => {
  it('通の複製', () => {
    expect(slice(DETAIL, 'const handleDuplicateStep', '\n  }\n')).not.toContain('delayMinutes: step.delayMinutes')
  })

  it('シナリオの複製', () => {
    expect(slice(DETAIL, 'const handleDuplicate =', '\n  }\n')).not.toContain('delayMinutes: step.delayMinutes')
  })
})
