import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * R301: 試算の入力を変えても前の成功結果が残る。
 * R302: 試算前の点数の空欄が 0 点として成功する。
 * R303: 名前が空のルールを「設定を反映」で一覧に追加できる。
 * 振る舞いの本体は `score-rules-validation.test.ts` が、
 * 画面への配線はここが守る。
 */
describe('R301: 試算後に点数・行動を変えたら古い結果を見せない', () => {
  it('点数・行動の入力を変えたら成功結果を消す', () => {
    expect(PAGE).toContain("setTestScore(event.target.value); setTestScoreError(''); setTestResult(null)")
    expect(PAGE).toContain("setTestEvent(value); setTestError(''); setTestResult(null)")
  })

  it('遅れて届いた古い応答を新しい入力へ表示しない', () => {
    expect(PAGE).toContain('testRunRef')
    expect(PAGE).toContain('if (testRunRef.current !== runId) return')
  })
})

describe('R302: 試算前の空欄は必須エラーにする', () => {
  it('送る前に文字で確かめ、空欄を0として送らない', () => {
    expect(PAGE).toContain('validateTestScore(testScore, bundle.bands)')
    expect(PAGE).not.toContain('currentScore: Number(testScore)')
  })
})

describe('R303: 空の表示名では一覧へ追加しない', () => {
  it('反映前に名前を確かめ、空欄では窓を閉じない', () => {
    expect(PAGE).toContain('validateRuleName(editDraft.name)')
    expect(PAGE).toContain("setEditError(checked.error)")
  })

  it('理由は表示名の欄の下に出す', () => {
    expect(PAGE).toContain('error={editError || undefined}')
  })
})
