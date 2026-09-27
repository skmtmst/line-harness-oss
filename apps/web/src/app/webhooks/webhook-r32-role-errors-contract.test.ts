import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * R32: 統括限定の受け取り口・送り先の作成を、管理者に見せない。
 * 失敗は「通信を確かめて」に畳まず、原因どおりに案内する。
 *
 * 口側の守り（`requireRole('owner')`）は変えない。ここでは画面側だけを見る。
 * 直しを戻すと赤くなること: 作成ボタンの無条件表示・`window.location.origin`
 * への戻し・ blanket の「通信を確かめて」の復活で落ちる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const OVERVIEWS = readFileSync(join(HERE, 'webhook-overviews.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(HERE, 'new', 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const HELPER = readFileSync(
  join(HERE, '..', '..', 'components', 'shared', 'api-error-message.ts'),
  'utf8',
)

describe('R32 作成の操作は権限に合わせる', () => {
  it('作成の可否は入り直した本人の役割で決め、手元の保存値で決めない', () => {
    for (const [name, body] of [['page.tsx', PAGE], ['new/page.tsx', NEW_PAGE], ['edit/page.tsx', EDIT_PAGE]]) {
      expect(body, `${name} が役割を確認していない`).toContain('api.staff.me()')
      expect(body, `${name} が手元の保存値で判定している`).not.toContain("localStorage.getItem('lh_staff_role')")
    }
  })

  it('統括でなければ作成ボタンを出さず、統括への依頼を案内する', () => {
    expect(PAGE).toContain('受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。')
    expect(PAGE).toContain('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
    expect(PAGE).toContain('canCreate')
    expect(NEW_PAGE).toContain('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
    expect(EDIT_PAGE).toContain('送り先の変更は統括だけができます。必要なときは統括に頼んでください。')
  })

  it('見本から作る・見本タブの作成も統括だけに出す（戻したら赤）', () => {
    // 一覧の「見本から作る」は作成の入口なので、無条件表示に戻すと落ちる。
    expect(PAGE).toContain('見本から作る')
    expect(PAGE).toMatch(/\{canCreate \? \(\s*<Button variant="secondary" href="\/webhooks\?tab=notify">見本から作る/)
    // 見本タブの中の作成も同じく統括だけ。役割の確認なしに戻すと落ちる。
    expect(PAGE).toContain('canCreateSamples')
    expect(PAGE).toContain('api.staff.me()')
    expect(PAGE).toContain('この見本で作る')
    expect(PAGE).toContain('送り先を作る')
  })

  it('一覧の変更操作（開始・停止・合言葉・削除・直す）も統括だけに出す', () => {
    expect(PAGE).toContain('canManage={canCreate}')
    expect(OVERVIEWS).toContain('canManage: boolean')
    // 試し送信は管理者も使えるので残す。
    expect(OVERVIEWS).toContain('届いたつもりで試す')
    expect(OVERVIEWS).toContain('1回 試してみる')
  })
})

describe('R32 失敗の文は原因どおりに', () => {
  it('共通の言い分け関数を shared に持ち、画面はそれを使う', () => {
    expect(HELPER).toContain('classifyApiFailure')
    expect(HELPER).toContain('describeApiFailure')
    expect(HELPER).toContain('forbidden')
    for (const [name, body] of [['page.tsx', PAGE], ['webhook-overviews.tsx', OVERVIEWS]]) {
      expect(body, `${name} が共通関数を使っていない`).toContain('describeApiFailure')
    }
  })

  it('受け取り口の作成失敗を「通信を確かめて」に畳まない', () => {
    expect(PAGE).not.toContain('作成に失敗しました。通信を確かめて、もう一度お試しください。')
    expect(PAGE).not.toContain('シークレットの更新に失敗しました。通信を確かめて、もう一度お試しください。')
    expect(OVERVIEWS).not.toContain('試せませんでした。通信を確かめて、もう一度お試しください。')
  })

  it('入力の直しは欄の下に出す', () => {
    expect(PAGE).toContain('createFieldError')
    expect(PAGE).toContain('mapIncomingCreateFieldError')
    expect(PAGE).toContain('role="alert"')
  })
})

describe('C33 受け取り口のURLはAPIの住所で組み立てる', () => {
  it('管理画面の住所（window.location.origin）で組み立てない', () => {
    expect(PAGE).not.toContain('window.location.origin')
    expect(PAGE).toContain('NEXT_PUBLIC_API_URL')
    expect(PAGE).toContain('/api/webhooks/incoming/${id}/receive')
  })
})
