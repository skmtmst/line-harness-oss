import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 i5SN2j イベント申込者の次行動と安全なキャンセル', () => {
  it('4枚の帯を数だけで終わらせず次にすることへつなぐ', () => {
    expect(PAGE).toContain('describeBookingCapacity(applied, capacity)')
    expect(PAGE).toContain('対応が必要：')
    expect(PAGE).toContain('件を確認してください')
    expect(PAGE).toContain('確認待ちはありません')
    expect(PAGE).toContain('空きが出たら順に案内します')
    expect(PAGE).toContain('受付設定を確認してください')
    expect(PAGE).toContain('空いた枠を確認してください')
    expect(PAGE).toContain('キャンセルはありません')
  })

  it('運営キャンセルをブラウザ標準confirmで直に実行しない', () => {
    expect(PAGE).not.toContain("if (!confirm('運営側でキャンセルしますか？友だちにLINE通知が送られます。')) return")
    expect(PAGE).toContain('data-qa-open="i5SN2j-cancel"')
    expect(PAGE).toContain('open={cancelTarget !== null}')
    expect(PAGE).toContain('友だちへLINEで通知します')
    expect(PAGE).toContain('申込と操作の履歴は残ります')
    expect(PAGE).toContain('この操作は取り消せません')
  })

  it('二重実行を止め、失敗しても窓を閉じず画面の言葉を出す', () => {
    expect(PAGE).toContain('if (!selectedAccountId || !eventId || !cancelTarget || busy) return')
    expect(PAGE).toContain('busy={busy}')
    expect(PAGE).toContain('error={cancelError}')
    expect(PAGE).toContain('予約をキャンセルできませんでした。状態を読み直してから')
    expect(PAGE).toContain('setCancelTarget(null)')
  })

  it('拒否理由をブラウザ標準promptで聞かず、送信範囲が分かる窓で確認する', () => {
    expect(PAGE).not.toContain('window.prompt')
    expect(PAGE).toContain('data-qa-open="i5SN2j-reject"')
    expect(PAGE).toContain('open={rejectTarget !== null}')
    expect(PAGE).toContain('運用メモ（任意）')
    expect(PAGE).toContain('このメモは友だちへ送られません')
    expect(PAGE).toContain("rejectReason.trim() || undefined")
    expect(PAGE).toContain('error={rejectError}')
  })

  it('名前を取れない行とCSVへ内部IDを出さない', () => {
    expect(PAGE).not.toContain('friend_id.slice(0, 8)')
    expect(PAGE).not.toContain("(b.line_account_id ?? '').slice(0, 8)")
    expect(PAGE).toContain('友だちは未取得')
    expect(PAGE).toContain('アカウントは未取得')
  })
})
