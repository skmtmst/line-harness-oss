import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/** 名前で見つけた関数の本体だけを切り出す。ファイル全体を見ると素通しになる。 */
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} が見つかりません`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`${decl} の本体が閉じていません`)
}

function dialog(src: string): string {
  const from = src.indexOf('<ConfirmDialog')
  if (from < 0) throw new Error('<ConfirmDialog が見つかりません')
  const to = src.indexOf('/>', from)
  if (to < 0) throw new Error('確認窓が閉じていません')
  return src.slice(from, to + 2)
}

describe('Webhookの削除確認', () => {
  it('ブラウザのconfirmを使わず、共通の確認窓へ移す', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      .not.toMatch(/[^.\w]confirm\(/)
  })

  it('受信と送信のどちらも、同じ窓を通って削除する', () => {
    const body = fnBody(PAGE, 'const handleConfirmDelete = async ()')
    expect(body).toContain("kind === 'incoming'")
    expect(body).toContain('api.webhooks.incoming.delete(deleteTarget.id, requestAccountId)')
    expect(body).toContain('api.webhooks.outgoing.delete(deleteTarget.id, requestAccountId)')
  })

  it('削除の処理が二度押しを受け付けない', () => {
    const body = fnBody(PAGE, 'const handleConfirmDelete = async ()')
    expect(body, '押している間の二度押しを止めていない').toContain('if (!deleteTarget || deleting) return')
    expect(body).toContain('setDeleting(true)')
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setDeleting\(false\)/)
  })

  it('削除の失敗を握りつぶさず、窓の中に運用の言葉で出す', () => {
    const body = fnBody(PAGE, 'const handleConfirmDelete = async ()')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を窓に出していない').toContain(
      'この${label}を削除できませんでした。状態を読み直してから、もう一度お試しください。',
    )
    expect(body, '生のAPIエラーをそのまま出している').not.toMatch(/setDeleteError\(\s*(res\.error|String\(|e\b)/)
    expect(body, '成功していないのに窓を閉じている').toMatch(
      /throw new Error\(res\.error\)[\s\S]*setDeleteTarget\(null\)/,
    )
  })

  it('窓を開けたままアカウントを切り替えられたら、消さずに選び直させる', () => {
    const ask = fnBody(PAGE, "const askDelete = (kind: 'incoming' | 'outgoing'")
    expect(ask, '押した時点のアカウントを固定していない').toContain(
      'setDeleteTarget({ kind, id, name, accountId: requestAccountId })',
    )

    const body = fnBody(PAGE, 'const handleConfirmDelete = async ()')
    expect(body, '固定したアカウントを使っていない').toContain('const requestAccountId = deleteTarget.accountId')
    expect(body, '切替を見ていない').toContain(
      'if (requestAccountId !== selectedAccountId || loadedAccountId !== requestAccountId)',
    )
    expect(body, '切替に気づいても消してしまう').toMatch(
      /loadedAccountId !== requestAccountId\)\s*\{[\s\S]{0,240}?return\s*\n/,
    )
    expect(body).toContain(
      'LINEアカウントが切り替わりました。削除するWebhookを選び直してください。',
    )
  })

  it('受信と送信で、止まるものの言い方を分ける', () => {
    const jsx = dialog(PAGE)
    expect(jsx, '受け口が使えなくなることを言っていない').toContain(
      'この受け口のURLは使えなくなり、これから届く通知は受け取れなくなります。',
    )
    expect(jsx, '送信が止まることを言っていない').toContain(
      'この宛先への送信が止まり、これから起きる出来事は通知されなくなります。',
    )
    expect(jsx, '記録が残ることを言っていない').toContain('すでに受け取った記録は残ります。')
    expect(jsx).toContain('すでに送った記録は残ります。')
    expect(jsx).toContain('この操作は取り消せません。')
  })

  it('確認窓が取り消せない操作として出て、処理中は閉じられない', () => {
    const jsx = dialog(PAGE)
    expect(jsx, '対象の名前を読ませていない').toContain('deleteTarget?.name')
    expect(jsx).toContain('destructive')
    expect(jsx).toContain('confirmLabel="削除する"')
    expect(jsx, '処理中でも押せてしまう').toContain('busy={deleting}')
    expect(jsx, '失敗が窓の中に出ない').toContain('error={deleteError}')
    expect(jsx, '処理中に閉じられてしまう').toContain('if (deleting) return')
  })

  it('削除ボタンは窓を開くだけで、押した時点では消さない', () => {
    expect(PAGE).toContain("onClick={() => askDelete('incoming', wh.id, wh.name)}")
    expect(PAGE).toContain("onClick={() => askDelete('outgoing', wh.id, wh.name)}")
  })
})
