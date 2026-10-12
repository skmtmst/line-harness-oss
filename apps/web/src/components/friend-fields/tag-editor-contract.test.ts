import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8')
const EDITOR = read('v8/tag-edit/edit-form.tsx')
const MODEL = read('v8/tag-edit/model.ts')
const SAVE = read('v8/tag-edit/edit.tsx')
describe('現役V8のタグ編集', () => {
  it('友だち一覧の表示設定は現在の編集の選ぶ欄から変える', () => {
    expect(EDITOR).toContain('label="友だち一覧に出す"')
    expect(EDITOR).toContain('checked={isStarred} onChange={setIsStarred}')
    expect(EDITOR).not.toContain('タグ一覧の星をクリック')
  })
  it('連動がOFFでも使える用途とONにしたあとの設定を案内する', () => {
    expect(EDITOR).toContain('手動付与・配信の絞り込み・シナリオの条件には使えます')
    expect(EDITOR).toContain('付いたときの動きとマイルを決められます')
    expect(MODEL).toContain("label: '1.2倍'")
    expect(EDITOR).toContain('<LinkedActionList')
  })
  it('OFFに戻しても積んだマイルは取り消されないことを伝える', () => {
    expect(EDITOR).toContain('オフに戻すと、これ以降このタグが付いても連動は動きません')
    expect(EDITOR).toContain('すでに積んだマイルは取り消されません')
  })
  it('使い道と使っている所を現在の右欄で確認できる', () => {
    expect(EDITOR).toContain('使っている所')
    expect(MODEL).toContain("label: '一斉配信'")
    expect(MODEL).toContain("label: '回答フォーム'")
    expect(EDITOR).toContain('row.count > 0 && row.href')
  })
  it('編集から同じタグを複製して作れる', () => {
    expect(EDITOR).toContain('複製して作る')
    expect(EDITOR).toContain('href={`/tags/new?copy=${tag.id}`}')
  })
  it('R620: 遡及OFFでは既存へ反映せず、確認した時だけ反映する', () => {
    expect(EDITOR).toContain('if (applyToExisting && (tag.friendCount ?? 0) > 0')
    expect(EDITOR).toContain('void onSave(values, false)')
    expect(SAVE).toContain('applyToExisting: applyRetroactive && values.applyToExisting')
  })
})
