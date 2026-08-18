import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('V3 10-4 運用状態の表示確認', () => {
  it('Penの文字階層を3タブで共通利用する', () => {
    expect(source).toContain('text-[28px] leading-tight font-bold')
    expect(source).toContain('text-xl font-bold text-gray-900">チェック結果')
    expect(source).toContain('text-xl font-bold text-gray-900">エラー内容')
    expect(source).toContain('text-xl font-bold text-gray-900">緊急停止')
    expect(source).toContain('text-xl font-bold text-blue-900">復旧')
    expect(source).toContain('text-xl font-bold text-gray-900">履歴')
    expect(source).toContain('text-[11px] font-bold')
  })

  it('タブごとの説明をPenと同じ内容で表示する', () => {
    expect(source).toContain('問題がないか自動で確認し、エラーがあれば内容と次の行動を表示します。')
    expect(source).toContain('止める配信を選び、理由を入力して緊急停止します。')
    expect(source).toContain('エラー、緊急停止、システム更新、設定変更を時間順に確認できます。')
  })

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
