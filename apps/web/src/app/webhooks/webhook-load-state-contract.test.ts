import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 外部連携の一覧の読み込み状態の禁止の見張り。送る・受け取るを別々に読み、失敗を空と見せず
 * 共通の再読み込み口で読み直すことは v8/webhooks/overview-behavior・interactions-behavior の試験が画面で確かめる。
 */
const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')

describe("管理画面 外部連携の一覧状態", () => {
  it('古い個別の読み直しボタンを戻さない（★管理画面 `x63W5x`）', () => {
    expect(OVERVIEWS).not.toContain('onClick={onReload}')
  })
})
