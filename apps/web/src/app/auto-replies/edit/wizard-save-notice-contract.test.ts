import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const WIZARD = readFileSync(new URL('../../../v8/auto-replies/edit/wizard.tsx', import.meta.url), 'utf8')

/*
 * 保存できた時だけ知らせる・競合の帯を頭の下に出す動きは
 * v8/auto-replies/edit/wizard-behavior.test.tsx が押して確かめる。
 * ここには戻してはいけない形の禁止の見張りだけを残す。
 */
describe('自動応答を作る（V8）の「下書きとして保存」', () => {
  it('保存できなかったとき（競合 UGrd2 など）は「下書きを保存しました」を出さない', () => {
    expect(WIZARD).not.toMatch(/saved \|\| autoReplyId\) setSaveNotice/)
  })

  it('本文の上に競合と同じ知らせ（赤い帯）を重ねない', () => {
    expect(WIZARD).not.toContain("setError('ほかの変更が先に保存されました")
  })
})
