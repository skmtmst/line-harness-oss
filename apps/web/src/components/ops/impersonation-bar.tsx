'use client'

import { Eye, PencilLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { api, type OpsImpersonation } from '@/lib/api'
import { opsCall } from '@/components/ops/ops-ui'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import NoteBar from '@/components/shared/note-bar'
import { TextArea } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'

/**
 * 代理ログイン帯（★V6 37 共通 `WXp5T`）。代理ログイン中は全画面の上に常時出す。
 *
 * - 閲覧中（赤 `status-danger`）: 「◯◯ として閲覧中（書き込みはできません）」
 * - 書き込み中（濃い赤 `danger`）: 「◯◯ として書き込み中」
 * - 時間制限は無い。終わるのは「代理ログインを終える」を押したときだけ
 * - 書き込みへの切り替え（37-5-A）と個人情報の表示（37-5-B）は理由が必須
 */
export default function ImpersonationBar({
  initial,
  onChange,
}: {
  initial: OpsImpersonation
  onChange?: (next: OpsImpersonation | null) => void
}) {
  const router = useRouter()
  const [state, setState] = useState<OpsImpersonation>(initial)
  const [dialog, setDialog] = useState<'write' | 'pii' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const update = (next: OpsImpersonation | null) => {
    if (next) setState(next)
    // 帯の状態が変わったら、AuthGuard の確認結果（切替前のもの）を次に使わせない（V6R-S0-a）。
    forgetSessionSnapshot()
    onChange?.(next)
  }

  const toRead = async () => {
    setBusy(true)
    const res = await opsCall(api.ops.impersonation.read())
    setBusy(false)
    if (res.success) update({ ...state, mode: 'read' })
  }

  const end = async () => {
    setBusy(true)
    const res = await opsCall(api.ops.impersonation.end())
    setBusy(false)
    if (res.success) {
      forgetSessionSnapshot()
      onChange?.(null)
      router.push('/ops/tenants')
      router.refresh()
    }
  }

  const submitReason = async (reason: string) => {
    if (!dialog) return
    setBusy(true)
    setError('')
    const res = dialog === 'write'
      ? await opsCall(api.ops.impersonation.write(reason))
      : await opsCall(api.ops.impersonation.revealPii(reason))
    setBusy(false)
    if (!res.success) { setError(res.error || '切り替えできませんでした'); return }
    update({ ...state, ...res.data, tenantName: state.tenantName })
    setDialog(null)
    router.refresh()
  }

  const writing = state.mode === 'write'
  const name = state.tenantName ?? '契約先'

  return (
    <>
      <div
        data-design-node="WXp5T"
        role="status"
        className={writing
          ? 'flex h-12 items-center justify-between gap-3 bg-danger px-5 text-on-accent'
          : 'flex h-12 items-center justify-between gap-3 bg-danger px-5 text-on-accent'}
      >
        <span className="flex min-w-0 items-center gap-2.5 text-label font-bold">
          {writing ? <PencilLine aria-hidden="true" className="h-4.5 w-4.5" /> : <Eye aria-hidden="true" className="h-4.5 w-4.5" />}
          <span className="truncate">
            {name} として{writing ? '書き込み中' : '閲覧中（書き込みはできません）'}
            {state.piiRevealed ? '・個人情報を表示中' : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!state.piiRevealed ? (
            <BarButton onClick={() => setDialog('pii')} disabled={busy}>個人情報を表示する</BarButton>
          ) : null}
          {writing ? (
            <BarButton onClick={() => void toRead()} disabled={busy}>閲覧のみに戻す</BarButton>
          ) : (
            <BarButton onClick={() => setDialog('write')} disabled={busy}>書き込みに切り替える</BarButton>
          )}
          <BarButton onClick={() => void end()} disabled={busy} solid>代理ログインを終える</BarButton>
        </span>
      </div>
      {dialog ? (
        <ReasonDialog
          kind={dialog}
          busy={busy}
          error={error}
          onClose={() => { setDialog(null); setError('') }}
          onSubmit={submitReason}
        />
      ) : null}
    </>
  )
}

/**
 * 帯の上に置く小さなボタン。帯の色（赤）の上に乗るので、共通 `Button` の
 * 白地・緑地ではなく、帯と同じ色系で描く。
 */
function BarButton({ onClick, disabled, solid, children }: { onClick: () => void; disabled?: boolean; solid?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={solid
        ? 'h-8 rounded-control bg-canvas px-3.5 text-caption font-bold text-danger disabled:opacity-60'
        : 'h-8 rounded-control border border-on-accent/60 bg-on-accent/15 px-3.5 text-caption font-bold text-on-accent hover:bg-on-accent/25 disabled:opacity-60'}
    >
      {children}
    </button>
  )
}

/** 理由の入力（37-5-A `Ve2FS` / 37-5-B `oVhwg`）。共通の確認ダイアログに入力欄を載せる。 */
function ReasonDialog({
  kind,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  kind: 'write' | 'pii'
  busy: boolean
  error: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const write = kind === 'write'
  const ready = reason.trim().length >= 4
  return (
    <ConfirmDialog
      open
      designNode={write ? 'Ve2FS' : 'oVhwg'}
      title={write ? '書き込みに切り替えますか？' : '個人情報を表示しますか？'}
      description={write
        ? 'ここから先の操作は、契約先のデータを実際に書き換えます。書き込みをすると、契約先の画面にも履歴が残ります。'
        : '友だちの氏名や会話の中身が見えるようになります。代理ログインを終えると、もとの伏せた表示に戻ります。'}
      confirmLabel={write ? '書き込みに切り替える' : '表示する'}
      destructive
      busy={busy}
      error={error}
      onConfirm={ready ? () => void onSubmit(reason.trim()) : undefined}
      onCancel={() => { if (!busy) onClose() }}
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1.5 block text-caption font-bold text-ink">理由<RequiredBadge /><span className="font-normal text-ink-faint">（4文字以上）</span></span>
          <TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={write ? '例：お問い合わせ #2481。回答フォームの送信先タグが外れているため付け直します。' : '例：お問い合わせ #2481。配信が届かない友だちを特定するため。'}
          />
        </label>
        <NoteBar tone="warn">
          {write
            ? '解約・権限者の削除・LINE公式アカウントの削除は、運営でも行えません'
            : '表示した記録は、日時・運営者・契約先・理由とともに監査ログに残ります'}
        </NoteBar>
      </div>
    </ConfirmDialog>
  )
}
