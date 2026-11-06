import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(join(__dirname, 'support-mark-rules-panel.tsx'), 'utf8')

/**
 * 禁止の見張りだけを文字で持つ。動き（開いても書かない・版競合で閉じない など）は
 * `support-mark-rules-panel-react.test.tsx` が描いて押して見る。
 */
describe('対応マークの自動変更ルール（GMvBd）の禁止の見張り', () => {
  it('開いたときの効果と読み込みから書き込みの口を呼ばない', () => {
    const effect = PANEL.slice(PANEL.indexOf('useEffect(() => {'), PANEL.indexOf('if (!markId)'))
    const load = PANEL.slice(PANEL.indexOf('const load = useCallback'), PANEL.indexOf('useEffect(() => {'))
    for (const write of ['createAutomationRule', 'updateAutomationRule', 'archiveAutomationRule']) {
      expect(effect).not.toContain(write)
      expect(load).not.toContain(write)
    }
  })

  it('保存の失敗の枝で窓を閉じない', () => {
    const save = PANEL.slice(PANEL.indexOf('const save = async'), PANEL.indexOf('const archive = async'))
    expect(save.slice(save.indexOf('} catch (err) {'))).not.toContain('setEditingId(null)')
  })
})
