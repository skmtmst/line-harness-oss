/*
 * 行うことの行の題。種類と並んで出るので、種類の言葉を繰り返さず
 * 行を見分ける中身（送る文・選んだ先）だけを出す。
 */
import { describe, expect, it } from 'vitest'
import type { FormAction } from '@line-crm/shared'
import { formActionTitle } from './action-editor'
import type { FormRefs } from './form-refs'

const refs: FormRefs = {
  tags: [{ id: 'tag-1', name: '来店' }],
  friendFields: [{ id: 'field-1', name: '会員番号', ecIsMaster: false }],
  scenarios: [{ id: 'sc-1', name: '初回フォロー' }],
  reminders: [{ id: 're-1', name: '来店前日' }],
  templates: [{ id: 'tpl-1', name: 'お礼', type: 'text' }],
}

describe('行うことの行の題は種類と重ねない', () => {
  it('テキストは送る文だけ', () => {
    expect(formActionTitle({ kind: 'send_text', text: 'ありがとう' }, refs)).toBe('「ありがとう」')
    expect(formActionTitle({ kind: 'send_text', text: '' }, refs)).toBe('（本文が未設定）')
  })
  it('選ぶ物は選んだ先だけ', () => {
    expect(formActionTitle({ kind: 'tag', op: 'add', tagIds: ['tag-1'] }, refs)).toBe('「来店」')
    expect(formActionTitle({ kind: 'send_template', templateId: 'tpl-1' }, refs)).toBe('「お礼」')
    expect(formActionTitle({ kind: 'reminder', reminderId: 're-1' }, refs)).toBe('「来店前日」')
  })
  it('動きの向きが要る物だけ向きを残す', () => {
    const stop: FormAction = { kind: 'scenario', op: 'stop', scenarioId: 'sc-1' }
    expect(formActionTitle({ kind: 'scenario', op: 'start', scenarioId: 'sc-1' }, refs)).toBe('「初回フォロー」を開始')
    expect(formActionTitle(stop, refs)).toBe('「初回フォロー」を停止')
    expect(formActionTitle({ kind: 'friend_field', fieldId: 'field-1', value: '1' }, refs)).toBe('「会員番号」に書く')
  })
  it('未選択は未選択と言う', () => {
    expect(formActionTitle({ kind: 'tag', op: 'add', tagIds: [] }, refs)).toBe('（未選択）')
    expect(formActionTitle({ kind: 'send_template', templateId: '' }, refs)).toBe('（未選択）')
  })
  it('選んだ先が消えた・読めないときは見つかりませんと言う', () => {
    expect(formActionTitle({ kind: 'tag', op: 'add', tagIds: ['gone'] }, refs)).toBe('（見つかりません）')
    expect(formActionTitle({ kind: 'send_template', templateId: 'gone' }, refs)).toBe('（見つかりません）')
  })
})
