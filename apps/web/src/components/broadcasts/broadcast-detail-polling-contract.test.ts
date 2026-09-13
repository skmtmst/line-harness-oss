import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(new URL('./broadcast-detail.tsx', import.meta.url), 'utf8')

describe('送信中の進捗取得', () => {
  it('5秒起点の1本だけで進捗とアカウント別内訳を更新し、非表示・失敗・上限を土台に任せる', () => {
    const progressBlock = detail.slice(
      detail.indexOf('// 送信中は進捗とアカウント別内訳を同じ応答で読む'),
      detail.indexOf('// Load insight for sent broadcasts'),
    )
    expect(progressBlock).toContain('startVisiblePoll')
    // 自前の setInterval / 可視分岐は持たない(土台が1本にまとめる)。
    expect(progressBlock).not.toContain('setInterval')
    expect(progressBlock).not.toContain('document.hidden')
    /* 成功時の応答を変数に取り出してから両方を更新する（#490 軽3）。 */
    expect(progressBlock).toContain('const data = res.data')
    expect(progressBlock).toContain('setPerAccountStats(data.perAccountStats)')
    expect(progressBlock).not.toContain('api.broadcasts.perAccountStats')
    // 失敗は投げて数え直し、上限後は止まって再試行を出す。
    expect(progressBlock).toContain('onGiveUp')
    expect(progressBlock).toContain('onRecovered')
  })

  it('上限後は理由と再試行ボタンを出す', () => {
    expect(detail).toContain('progressStalled')
    expect(detail).toContain('進捗の更新を一時停止しています')
    expect(detail).toContain('再試行する')
  })

  it('全取得に世代ID(別画面の遅い応答は捨てる)', () => {
    // 全文・進捗・洞察の3口とも最新IDと照合する。
    expect(detail).toContain('const requestId = id')
    expect(detail).toContain('requestId !== latestIdRef.current')
    // 進捗の古い応答は失敗にも数えない。
    const progressBlock = detail.slice(
      detail.indexOf('work: async () => {'),
      detail.indexOf('onGiveUp: () => setProgressStalled'),
    )
    expect(progressBlock).toContain('if (requestId !== latestIdRef.current) return')
  })

  it('古い全文で送信完了を戻さない(全文と進捗の順序逆転防止)', () => {
    expect(detail).toContain("prev.status === 'sent'")
  })
})
