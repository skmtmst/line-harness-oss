import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RELEASE = readFileSync(
  new URL('../../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
)
const PR_GATE = readFileSync(
  new URL('../../../../.github/workflows/required-pr-gate.yml', import.meta.url),
  'utf8',
)

/*
 * R152: api.ts は読み込み時に NEXT_PUBLIC_API_URL を要求する。PR側の検査は
 * 設定済みだが、正式リリース workflow のテスト工程にだけ無かった。タグからの
 * 正式配布物がテスト段階で止まるので、同じ前提をこちらにも置く。
 */
describe('R152 正式リリースのテスト工程にも NEXT_PUBLIC_API_URL がある', () => {
  it('release.yml のテスト工程が NEXT_PUBLIC_API_URL を設定する', () => {
    const testStep = RELEASE.match(
      /name: Run every populated workspace test suite[\s\S]*?(?=\n\s*- name:|\s*$)/,
    )?.[0] ?? ''
    expect(testStep).toContain('NEXT_PUBLIC_API_URL')
    expect(testStep).toContain('pnpm --filter web test')
  })

  it('PR検査と同じ値を使う（外部へ出ない試験用URL）', () => {
    const prValue = PR_GATE.match(/NEXT_PUBLIC_API_URL:\s*(\S+)/)?.[1]
    const releaseValue = RELEASE.match(/NEXT_PUBLIC_API_URL:\s*(\S+)/)?.[1]
    expect(prValue).toBeTruthy()
    expect(releaseValue).toBe(prValue)
  })
})
