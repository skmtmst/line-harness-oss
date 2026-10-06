import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WIZARD = readFileSync(join(__dirname, 'wizard-v8.tsx'), 'utf8')

describe('自動応答を作る（V8）の「下書きとして保存」', () => {
  it('保存できなかったとき（競合 UGrd2 など）は「下書きを保存しました」を出さない', () => {
    expect(WIZARD).toContain("if (saved) setSaveNotice('下書きを保存しました')")
    expect(WIZARD).not.toMatch(/saved \|\| autoReplyId\) setSaveNotice/)
  })

  it('競合の帯は頭の下に出し、本文の上に同じ知らせ（赤い帯）を重ねない', () => {
    expect(WIZARD).toContain('className={styles.conflictBand} data-design-node="UGrd2"')
    expect(WIZARD).not.toContain("setError('ほかの変更が先に保存されました")
  })
})
