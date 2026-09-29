/*
 * R497: 見せる範囲の下書き（保存済みの写しと行単位の適用）。
 *
 * - 個別設定の保存済みキーはプリセットに当てはめず、そのまま3択へ写す
 * - 行を触った保存は触った行だけ変え、触っていない行の部分設定を落とさない
 * - 配信の行き来では操作キー（下書き・テスト・送信・CSV）も組で付く・外れる
 */
import { describe, expect, it } from 'vitest'
import { BROADCAST_EDIT_OPERATION_KEYS } from '@line-crm/shared'
import { applyScopeRowChange, restoreSavedLevels, scopePiiToEmailMask } from './staff-scope-draft'

describe('R497 保存済みを3択へ写す', () => {
  it('受信箱だけの個別設定は受信箱だけ変えられるで写す（受付の当てはめはしない）', () => {
    const levels = restoreSavedLevels(['/chats'], [], null)
    expect(levels.inbox).toBe('edit')
    expect(levels.delivery).toBe('none')
    expect(levels.booking).toBe('none')
    expect(levels.pii).toBe('view')
  })

  it('何も持たない人はすべて出さないで写す', () => {
    const levels = restoreSavedLevels([], [], undefined)
    expect(levels.inbox).toBe('none')
    expect(levels.delivery).toBe('none')
    expect(levels.pii).toBe('view')
  })

  it('メールの見せ方はそのまま写す', () => {
    expect(restoreSavedLevels([], [], 'full').pii).toBe('edit')
    expect(restoreSavedLevels([], [], 'none').pii).toBe('none')
    expect(restoreSavedLevels([], [], 'masked').pii).toBe('view')
  })
})

describe('R497 触った行だけ保存済みキーへ適用する', () => {
  it('触っていない行の部分設定（分析の1キーのみ）は落とさない', () => {
    const { edit, view } = applyScopeRowChange(['/chats', '/analytics'], [], 'inbox', 'view')
    // 受信箱は見えるだけへ変わる。
    expect(edit).not.toContain('/chats')
    expect(view).toContain('/chats')
    // 分析は触っていないので、1キーだけの部分設定のまま残る。
    expect(edit).toContain('/analytics')
  })

  it('出さないにするとその行のキーが両方から消える', () => {
    const { edit, view } = applyScopeRowChange(['/chats'], ['/friends', '/tags'], 'friends', 'none')
    expect(edit).not.toContain('/friends')
    expect(view).not.toContain('/friends')
    expect(view).not.toContain('/tags')
    expect(edit).toContain('/chats')
  })

  it('配信を変えられるにすると操作キーも組で付く', () => {
    const { edit } = applyScopeRowChange(['/chats'], [], 'delivery', 'edit')
    expect(edit).toContain('/broadcasts')
    for (const key of BROADCAST_EDIT_OPERATION_KEYS) expect(edit).toContain(key)
    expect(edit).toContain('/chats')
  })

  it('配信を出さないにすると操作キーも組で外れる', () => {
    const { edit, view } = applyScopeRowChange(
      ['/broadcasts', 'broadcast.definition.edit', '/chats'], [], 'delivery', 'none',
    )
    expect(edit).not.toContain('/broadcasts')
    expect(edit).not.toContain('broadcast.definition.edit')
    expect(edit).toContain('/chats')
    expect(view).toEqual([])
  })

  it('個人情報の行はキーに触らない（メールの見せ方は別枠）', () => {
    const { edit, view } = applyScopeRowChange(['/chats'], [], 'pii', 'edit')
    expect(edit).toEqual(['/chats'])
    expect(view).toEqual([])
  })

  it('3択の個人情報をメールの見せ方へ写す', () => {
    expect(scopePiiToEmailMask('edit')).toBe('full')
    expect(scopePiiToEmailMask('view')).toBe('masked')
    expect(scopePiiToEmailMask('none')).toBe('none')
    expect(scopePiiToEmailMask(undefined)).toBe('masked')
  })
})
