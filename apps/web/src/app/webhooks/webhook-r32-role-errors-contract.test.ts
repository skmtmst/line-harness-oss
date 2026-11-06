import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * R32: 統括限定の受け取り口・送り先の作成を、管理者に見せない。失敗は原因どおりに案内する。
 * C33: 受け取り口のURLはAPIの住所で組み立てる。
 *
 * 画面の出し分け・失敗の言葉・受け取りURLは webhook-role-gating-react・v8/webhooks/overview-behavior・
 * edit-authorization・webhooks/new/webhook-new-validation-react の試験が画面で確かめる。
 * ここには戻してはいけない書き方の禁止の見張りだけを残す。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')
const NEW_PAGE = readUiSource(join(HERE, 'new', 'page.tsx'), 'utf8')
const EDIT_PAGE = readUiSource(join(HERE, 'edit', 'page.tsx'), 'utf8')

describe('R32 作成の操作は権限に合わせる', () => {
  it('作成の可否を手元の保存値で決めない', () => {
    for (const [name, body] of [['page.tsx', PAGE], ['new/page.tsx', NEW_PAGE], ['edit/page.tsx', EDIT_PAGE]]) {
      expect(body, `${name} が手元の保存値で判定している`).not.toContain("localStorage.getItem('lh_staff_role')")
    }
  })
})

describe('R32 失敗の文は原因どおりに', () => {
  it('受け取り口の作成・合言葉・試しの失敗を「通信を確かめて」に畳まない', () => {
    expect(PAGE).not.toContain('作成に失敗しました。通信を確かめて、もう一度お試しください。')
    expect(PAGE).not.toContain('シークレットの更新に失敗しました。通信を確かめて、もう一度お試しください。')
    expect(OVERVIEWS).not.toContain('試せませんでした。通信を確かめて、もう一度お試しください。')
  })
})

describe('C33 受け取り口のURLはAPIの住所で組み立てる', () => {
  it('管理画面の住所（window.location.origin）で組み立てない', () => {
    expect(PAGE).not.toContain('window.location.origin')
  })
})
