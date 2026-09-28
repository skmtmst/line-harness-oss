/**
 * 監査 R255：必須内容が空の後続処理を未完成と示さず保存できる。
 *
 * 判定は Worker の実行前判定（`isScenarioActionComplete`）と同じにする。
 * 空の8種は具体的な不足を返し、埋めたら null になる。
 */
import { describe, expect, it } from 'vitest'
import { actionIncompleteReason, isInlineActionComplete } from './action-completeness'

describe('R255 空の後続処理は具体的な不足を返す', () => {
  it.each([
    ['tag', { op: 'add', tagIds: [] }, 'タグが選ばれていません'],
    ['friend_field', { fieldId: '', op: 'set', value: '' }, '友だち情報の項目が選ばれていません'],
    ['scenario', { op: 'start', scenarioId: '', restart: 'from_start' }, 'シナリオが選ばれていません'],
    ['common_var', { varKey: '', op: 'add', value: '1' }, '共通情報の項目が選ばれていません'],
    ['send_message', { content: '  ' }, '本文が空です'],
    ['send_template', { templateId: '' }, 'テンプレートが選ばれていません'],
    ['reminder', { reminderId: '' }, 'リマインダが選ばれていません'],
    ['event_booking', { eventId: '' }, 'イベントが選ばれていません'],
  ])('%s の空設定は未完成（%s）', (type, config, reason) => {
    expect(actionIncompleteReason(type, config)).toBe(reason)
    expect(isInlineActionComplete(type, config)).toBe(false)
  })

  it('埋めた8種は完成になる', () => {
    const complete: Array<[string, unknown]> = [
      ['tag', { op: 'add', tagIds: ['tag-1'] }],
      ['tag', { op: 'remove', folderId: 'folder-1' }],
      ['friend_field', { fieldId: 'f-1', op: 'set', value: 'a' }],
      ['support_mark', { markId: null }],
      ['support_mark', { markId: 'm-1' }],
      ['scenario', { op: 'start', scenarioId: 's-1', restart: 'from_start' }],
      ['scenario', { op: 'stop' }],
      ['common_var', { varKey: 'v-1', op: 'add', value: '1' }],
      ['send_message', { content: 'こんにちは' }],
      ['send_template', { templateId: 't-1' }],
      ['reminder', { reminderId: 'r-1' }],
      ['event_booking', { eventId: 'e-1' }],
    ]
    for (const [type, config] of complete) {
      expect(actionIncompleteReason(type, config), type).toBeNull()
    }
  })

  it('読めない設定・知らない種別も未完成として扱う（黙って完成にしない）', () => {
    expect(actionIncompleteReason('tag', null)).toBe('設定が読み取れません')
    expect(actionIncompleteReason('tag', '[]')).toBe('設定が読み取れません')
    expect(actionIncompleteReason('rich_menu_switch', {})).toBe('この処理の種類を確認できません')
  })

  it('不足の言葉に内部語（ID・列名）が出ない', () => {
    const reasons = [
      actionIncompleteReason('tag', { op: 'add', tagIds: [] }),
      actionIncompleteReason('send_message', { content: '' }),
      actionIncompleteReason('send_template', { templateId: '' }),
    ]
    for (const reason of reasons) {
      expect(reason).not.toMatch(/tagIds|templateId|config|Id/)
    }
  })
})
