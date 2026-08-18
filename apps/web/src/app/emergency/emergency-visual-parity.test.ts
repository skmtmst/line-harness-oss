import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('V3 10-4 運用状態の表示確認', () => {
  it('実データ表示と全UI確認を分離する', () => {
    expect(source).toContain('上部はシステムの実データです')
    expect(source).toContain('全UI確認（仮表示）')
    expect(source).toContain('確認後に条件表示')
  })

  it('運用で必要な6状態と主要操作を確認できる', () => {
    for (const label of ['正常', '注意', 'エラー', '未確認', '緊急停止中', '復旧待ち']) {
      expect(source).toContain(`label: '${label}'`)
    }
    for (const action of ['調査レポートを出力', '緊急停止の確認', '復旧の確認', '更新履歴を見る', '再確認中…']) {
      expect(source).toContain(action)
    }
  })
})
