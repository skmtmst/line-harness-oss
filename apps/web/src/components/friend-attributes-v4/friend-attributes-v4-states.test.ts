import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./friend-attributes-v4-states.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./friend-attributes-v4-states.module.css', import.meta.url), 'utf8')

describe('友だち属性V4の追加4状態', () => {
  it('Pen.devの実ノードIDを4状態に記録する', () => {
    for (const nodeId of ['C2g1N', 'S04qZM', 'WDAkW', 'sJE2f']) expect(source).toContain(nodeId)
    for (const sourceNodeId of ['ZAFby', 'yTPY6', 'cxtem', 'KPgel']) expect(source).toContain(sourceNodeId)
  })

  it('旧画面部品やTailwind表示へ戻さない', () => {
    for (const forbidden of ['friend-attributes-v2', 'friend-attributes-v3', '@/components/shared', 'className="flex', 'rounded-lg', 'text-gray-']) {
      expect(source).not.toContain(forbidden)
    }
    expect(source).toContain("import styles from './friend-attributes-v4-states.module.css'")
  })

  it('1920px設計の4状態と安全確認を表示できる', () => {
    for (const label of ['友だち情報欄', '対応マーク', '保存した検索', 'CSVでタグを一括登録', '受信時自動変更・削除・初期値の安全確認', '保存条件からコピー']) {
      expect(source).toContain(label)
    }
    expect(css).toContain('grid-template-columns: repeat(4')
    expect(css).toContain('position: fixed')
  })
})
