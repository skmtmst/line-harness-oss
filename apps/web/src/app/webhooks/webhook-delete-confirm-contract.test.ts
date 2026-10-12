import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const incoming = readFileSync(new URL('../../v8/webhooks/incoming.tsx', import.meta.url), 'utf8')
const outgoing = readFileSync(new URL('../../v8/webhooks/outgoing.tsx', import.meta.url), 'utf8')
const pages = [incoming, outgoing]
function deletion(src: string) { return src.slice(src.indexOf('const runDelete = async ()'), src.indexOf('const runDelete = async ()') + 1600) }
function dialog(src: string) { const start = src.indexOf('open={deleteTarget !== null}'); return src.slice(start, src.indexOf('/>', start)) }
describe('現役V8のWebhook削除確認', () => {
  it('ブラウザのconfirmではなく共通の確認窓を使う', () => {
    for (const src of pages) { expect(src).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'"); expect(src).not.toMatch(/[^.\w]confirm\(/) }
  })
  it('受信と送信のどちらも確認後に対象アカウントで削除する', () => {
    expect(deletion(incoming)).toContain('api.webhooks.incoming.delete(deleteTarget.id, accountId)')
    expect(deletion(outgoing)).toContain('api.webhooks.outgoing.delete(deleteTarget.id, accountId)')
    for (const src of pages) expect(dialog(src)).toContain('onConfirm={() => runDelete()}')
  })
  it('二度押しを止め、成功や失敗のあと処理中の印を戻す', () => {
    for (const src of pages) { const body = deletion(src); expect(body).toContain('if (!deleteTarget || deleting) return'); expect(body).toContain('setDeleting(true)'); expect(body).toMatch(/finally\s*\{[\s\S]*setDeleting\(false\)/) }
  })
  it('失敗時には窓を閉じず、理由を運用の言葉で出す', () => {
    for (const src of pages) { const body = deletion(src); expect(body).toContain('if (!res.success) throw new Error(res.error)'); expect(body).toContain('setDeleteError('); expect(body).toContain('状態を読み直してから、もう一度お試しください。'); expect(body.indexOf('throw new Error(res.error)')).toBeLessThan(body.indexOf('setDeleteTarget(null)')); expect(body).not.toMatch(/setDeleteError\(\s*(res\.error|String\()/) }
  })
  it('アカウント切替後は旧窓を消し、読み込み元と違うアカウントへ削除しない', () => {
    for (const src of pages) { expect(src).toContain('setDeleteTarget(null)'); const body = deletion(src); expect(body).toContain('loadedAccountId !== accountId'); expect(body).toContain('選び直してください。'); expect(body.indexOf('選び直してください。')).toBeLessThan(body.indexOf('api.webhooks.')); expect(body).toContain('if (accountRef.current !== accountId) return') }
    expect(deletion(outgoing)).toContain('const accountId = deleteTarget.accountId')
  })
  it('受信と送信で止まるものを分け、記録が残ることと取消不可を示す', () => {
    expect(dialog(incoming)).toContain('このURLへの通知を受け取らなくなります。')
    expect(dialog(incoming)).toContain('すでに受け取った記録は残ります。')
    expect(dialog(outgoing)).toContain('この宛先への送信が止まり')
    expect(dialog(outgoing)).toContain('すでに送った記録は残ります。')
    for (const src of pages) expect(dialog(src)).toContain('この操作は取り消せません。')
  })
  it('対象名を示し、処理中は閉じず、失敗は窓内へ出す', () => {
    for (const src of pages) { const jsx = dialog(src); for (const part of ['deleteTarget?.name', 'destructive', 'confirmLabel="削除する"', 'busy={deleting}', 'error={deleteError || undefined}']) expect(jsx).toContain(part); expect(jsx).toMatch(/if \((?:!deleting|deleting)\)/) }
  })
  it('削除の入口では対象を選ぶだけで即時削除しない', () => {
    expect(incoming).toContain('setDeleteTarget({ id: selected.id, name: selected.name })')
    expect(outgoing).toContain('setDeleteTarget({ id: item.id, name: item.name, accountId })')
    expect(outgoing).toContain('askDelete(item)')
  })
})
