import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const thread = readFileSync(new URL('./email-thread.tsx', import.meta.url), 'utf8')

describe('メール会話の定期取得 (#630)', () => {
  it('5秒起点の1本だけで取り直し、自前の setInterval は持たない', () => {
    expect(thread).toContain('startVisiblePoll')
    expect(thread).not.toContain('setInterval')
    expect(thread).toContain('onGiveUp')
    expect(thread).toContain('onRecovered')
  })

  it('未解決の間だけ動かし、対応済みでは回さない', () => {
    expect(thread).toContain("threadStatusRef.current !== 'resolved'")
  })

  it('静かな取り直しは成否を返し、失敗は投げて数え直す', () => {
    expect(thread).toContain('Promise<boolean>')
  })

  it('上限後は理由と再試行ボタンを出す', () => {
    expect(thread).toContain('threadStalled')
    expect(thread).toContain('会話の更新を一時停止しています')
    expect(thread).toContain('再試行する')
  })

  it('初回も同じ1本に載せ、外で別に走らせない', () => {
    expect(thread).toContain('immediate: true')
    expect(thread).not.toContain('void load()')
  })

  it('全取得に世代ID(別スレッドの遅い応答は捨てる)', () => {
    expect(thread).toContain('createPollGeneration')
    expect(thread).toContain('latestThreadRef')
    expect(thread).toContain('genRef.current.isStale(mySeq)')
  })
})
