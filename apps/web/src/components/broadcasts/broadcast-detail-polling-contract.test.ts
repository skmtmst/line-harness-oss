import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const detail = readFileSync(new URL('./broadcast-detail.tsx', import.meta.url), 'utf8')

describe('送信中の進捗取得', () => {
  it('5秒の1本だけで進捗とアカウント別内訳を更新し、非表示タブでは止める', () => {
    const progressBlock = detail.slice(
      detail.indexOf('// 送信中は進捗とアカウント別内訳を同じ応答で読む'),
      detail.indexOf('// Load insight for sent broadcasts'),
    )
    expect(progressBlock.match(/= setInterval/g)).toHaveLength(1)
    expect(progressBlock).toContain('5000')
    expect(progressBlock).toContain('document.hidden')
    /* 成功時の応答を変数に取り出してから両方を更新する（#490 軽3）。 */
    expect(progressBlock).toContain('const data = res.data')
    expect(progressBlock).toContain('setPerAccountStats(data.perAccountStats)')
    expect(progressBlock).not.toContain('api.broadcasts.perAccountStats')
  })
})
