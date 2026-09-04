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
  const to = src.indexOf('</ConfirmDialog>', from)
  if (to < 0) throw new Error('</ConfirmDialog> が見つかりません')
  return src.slice(from, to)
}

describe('一斉配信一覧の削除確認', () => {
  it('ブラウザのconfirmを使わず、共通の確認窓へ移す', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      .not.toMatch(/[^.\w]confirm\(/)
  })

  it('削除の処理が二度押しを受け付けない', () => {
    const body = fnBody(PAGE, 'const handleDelete = async ()')
    expect(body, '押している間の二度押しを止めていない').toContain('if (!deleteTarget || deleting) return')
    expect(body).toContain('setDeleting(true)')
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setDeleting\(false\)/)
  })

  it('削除の失敗を握りつぶさず、窓の中に運用の言葉で出す', () => {
    const body = fnBody(PAGE, 'const handleDelete = async ()')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を窓に出していない').toContain(
      "setDeleteError('この配信を削除できませんでした。状態を読み直してから、もう一度お試しください。')",
    )
    expect(body, '生のAPIエラーをそのまま出している').not.toMatch(/setDeleteError\(\s*(res\.error|String\(|e\b)/)
    expect(body, '成功していないのに窓を閉じている').toMatch(
      /throw new Error\(res\.error\)[\s\S]*setDeleteTarget\(null\)/,
    )
  })

  it('予約と下書きで、止まるものの言い方を分ける', () => {
    const jsx = dialog(PAGE)
    expect(jsx, '予約の取り消しに触れていない').toContain(
      '予約が取り消され、この配信は送られなくなります。',
    )
    expect(jsx, '下書きは誰にも届かないことを言っていない').toContain(
      'まだ送っていないので、友だちには何も届きません。',
    )
    expect(jsx, '送った記録が残ることを言っていない').toContain('すでに送った配信の記録は残ります。')
    expect(jsx).toContain('この操作は取り消せません。')
  })

  it('題は設計どおり、配信名だけを出す', () => {
    /*
     * 設計 `EGMb1` は「「8月キャンペーンのお知らせ」を削除しますか？」。
     * 「配信「…」」と種類を足すと、**何を消すのかは名前で分かるのに
     * 読む語だけが増える。**
     */
    const jsx = dialog(PAGE)
    expect(jsx).toContain("title={`「${deleteTarget?.title ?? ''}」を削除しますか？`}")
    expect(jsx, '設計に無い接頭辞が付いている').not.toContain('title={`配信「')
  })

  it('送信済みの配信に、下書きの言い方を出さない', () => {
    /*
     * 窓の本文は「予約済みかどうか」で分岐する。**送信済みにも削除を出すと、
     * else の枝が「まだ送っていないので、友だちには何も届きません。」という
     * 嘘の文を出す。** 削除の口は下書きと予約済みだけに置く。
     */
    expect(PAGE).toContain("{(broadcast.status === 'draft' || broadcast.status === 'scheduled') && (")
  })

  it('何を消すのかを、日時と送り先まで読み合わせる', () => {
    const jsx = dialog(PAGE)
    expect(jsx, '配信名を読ませていない').toContain('deleteTarget?.title')
    expect(jsx, '配信日時を読ませていない').toContain('formatDatetime(deleteTarget.scheduledAt)')
    expect(jsx, '送り先を読ませていない').toContain('audienceSummary(deleteTarget, getTagName)')
  })

  it('確認窓が取り消せない操作として出て、処理中は閉じられない', () => {
    const jsx = dialog(PAGE)
    expect(jsx).toContain('destructive')
    expect(jsx).toContain('confirmLabel="削除する"')
    expect(jsx, '処理中でも押せてしまう').toContain('busy={deleting}')
    expect(jsx, '失敗が窓の中に出ない').toContain('error={deleteError}')
    expect(jsx, '処理中に閉じられてしまう').toContain('if (deleting) return')
  })

  it('削除ボタンは窓を開くだけで、押した時点では消さない', () => {
    expect(PAGE).toContain("onClick={() => { setDeleteError(''); setDeleteTarget(broadcast) }}")
  })
})
