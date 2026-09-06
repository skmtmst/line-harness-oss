'use client'

/*
 * シナリオ詳細で使う小さな窓。
 *
 * 詳細画面は既に長いので、窓の中身はここに分けてある。1ファイルに足すと
 * 「どこを直すと何が変わるか」が追えなくなる。
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConditionBuilder, {
  isEmptyCondition,
  pruneCondition,
  type SegmentCondition,
} from '@/components/shared/condition-builder'

function Shell({
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className={`rounded-panel w-full bg-white shadow-lg ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
        <div className="border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-ink text-lg font-bold">{title}</h2>
            {description && <p className="text-ink-secondary mt-0.5 text-sm">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 shrink-0 border px-4 text-sm"
          >
            閉じる
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="border-hairline flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- 配信対象 */

export function ConditionDialog({
  title,
  description,
  value,
  onSave,
  onClose,
}: {
  title: string
  description: string
  value: SegmentCondition | null
  onSave: (next: SegmentCondition | null) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<SegmentCondition | null>(value)
  const [saving, setSaving] = useState(false)

  return (
    <Shell
      title={title}
      description={description}
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
          >
            やめる
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              // 書きかけの行は落として保存する。残すと、誰にも一致しない
              // 条件になって配信が黙って止まる。
              await onSave(pruneCondition(draft))
              setSaving(false)
              onClose()
            }}
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : 'この条件にする'}
          </button>
        </>
      }
    >
      <section className="bg-canvas-sunken rounded-panel mb-4 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-ink-faint text-xs">現在の条件</p>
            <p className="text-ink mt-1 text-sm font-bold">{describeCondition(draft)}</p>
          </div>
          <Button onClick={() => setDraft(null)}>
            条件を初期化
          </Button>
        </div>
      </section>
      <ConditionBuilder value={draft} onChange={setDraft} />
    </Shell>
  )
}

/* -------------------------------------------- 最終コンテンツ配信後の処理 */

export type OnCompleteMode = 'pause' | 'resume_previous' | 'move'

export const ON_COMPLETE_LABEL: Record<OnCompleteMode, string> = {
  pause: '一時停止',
  resume_previous: '1つ前のシナリオを再開',
  move: '次のシナリオへ移動',
}

export function OnCompleteDialog({
  scenarioId,
  mode,
  targetScenarioId,
  onSave,
  onClose,
  onOpenActions,
  actionCount,
}: {
  scenarioId: string
  mode: OnCompleteMode
  targetScenarioId: string | null
  onSave: (mode: OnCompleteMode, targetScenarioId: string | null) => Promise<string | null>
  onClose: () => void
  /** 「その他のアクション」を開く。配り終えた人にタグを付ける等。 */
  onOpenActions: () => void
  actionCount: number
}) {
  const [draftMode, setDraftMode] = useState<OnCompleteMode>(mode)
  const [draftTarget, setDraftTarget] = useState<string | null>(targetScenarioId)
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await api.scenarios.list()
      if (res.success) {
        setScenarios(res.data.filter((s) => s.id !== scenarioId).map((s) => ({ id: s.id, name: s.name })))
      }
    })()
  }, [scenarioId])

  return (
    <Shell
      title="最終ステップ後の処理"
      description="最後の1通を配り終えた人をどうするか"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
          >
            やめる
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              const err = await onSave(draftMode, draftMode === 'move' ? draftTarget : null)
              setSaving(false)
              if (err) {
                setError(err)
                return
              }
              onClose()
            }}
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : '変更する'}
          </button>
        </>
      }
    >
      {error && <p className="rounded-panel bg-danger-bg text-danger mb-4 px-4 py-3 text-sm">{error}</p>}
      <div className="space-y-3">
        {(
          [
            {
              value: 'pause' as const,
              hint: 'これまでと同じ。読み終えた人はそのまま止まります。',
            },
            {
              value: 'resume_previous' as const,
              hint: 'このシナリオを割り込みで始めた人を、元のシナリオの続きへ戻します。控えが無い人は止まったままです。',
            },
            {
              value: 'move' as const,
              hint: '読み終えた人を、続けて別のシナリオの1通目から始めます。',
            },
          ]
        ).map((opt) => (
          <label
            key={opt.value}
            className={`rounded-panel flex cursor-pointer gap-3 border p-4 ${
              draftMode === opt.value ? 'border-accent bg-accent-soft' : 'border-hairline'
            }`}
          >
            <input
              type="radio"
              className="mt-1"
              checked={draftMode === opt.value}
              onChange={() => setDraftMode(opt.value)}
            />
            <span className="min-w-0">
              <span className="text-ink block text-sm font-bold">{ON_COMPLETE_LABEL[opt.value]}</span>
              <span className="text-ink-secondary mt-0.5 block text-xs">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-hairline mt-5 border-t pt-5">
        <p className="text-ink text-sm font-bold">その他のアクション</p>
        <p className="text-ink-secondary mt-0.5 mb-2 text-xs">
          配り終えた人に対して、タグ・友だち情報・対応マークなどを動かします。
        </p>
        <button
          type="button"
          onClick={onOpenActions}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-4 text-sm"
        >
          アクション設定{actionCount > 0 ? `（${actionCount} 件）` : ''}
        </button>
      </div>

      {draftMode === 'move' && (
        <div className="mt-4">
          <label className="text-ink text-sm font-medium">移動先のシナリオ</label>
          <select
            value={draftTarget ?? ''}
            onChange={(e) => setDraftTarget(e.target.value || null)}
            className="border-hairline rounded-control text-ink mt-1.5 h-10 w-full border bg-white px-3 text-sm"
          >
            <option value="">選んでください</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </Shell>
  )
}

/* ------------------------------------------------------------- テスト送信 */

/** テスト送信で送る通の一覧に出す1行。 */
export interface TestSendStep {
  id: string
  stepOrder: number
  timing: string
  kind: string
}

export function TestSendDialog({
  scenarioId,
  lineAccountId,
  stepId,
  stepLabel,
  steps = [],
  onClose,
}: {
  scenarioId: string
  /** アカウント専用シナリオは、送り先も必ず同じアカウントから選ぶ。 */
  lineAccountId: string | null
  /** null なら全通を送る。 */
  stepId: string | null
  stepLabel: string
  /** 送る通。設計（g2UNV）は送る前に中身を1通ずつ見せる。 */
  steps?: readonly TestSendStep[]
  onClose: () => void
}) {
  const { selectedAccountId } = useAccount()
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState<{ id: string; displayName: string | null }[]>([])
  const [friendsStatus, setFriendsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [lastTest, setLastTest] = useState<{ sentAt: string; messageCount: number } | null>(null)
  const resolvedAccountId = lineAccountId ?? selectedAccountId ?? null

  const loadTestHistory = useCallback(async () => {
    if (!resolvedAccountId) {
      setLastTest(null)
      return
    }
    try {
      const response = await api.scenarios.runs(scenarioId, resolvedAccountId, { limit: 1 })
      const latest = response.success ? response.data.testSends[0] : null
      setLastTest(latest ? { sentAt: latest.sentAt, messageCount: latest.messageCount } : null)
    } catch {
      setLastTest(null)
    }
  }, [resolvedAccountId, scenarioId])

  useEffect(() => {
    void loadTestHistory()
  }, [loadTestHistory])

  useEffect(() => {
    let cancelled = false
    setFriends([])
    setSelected(null)
    setConfirming(false)
    setResult(null)
    setFriendsStatus('loading')
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.friends.list({
            accountId: lineAccountId ?? selectedAccountId ?? undefined,
            limit: 20,
            search,
            includeTags: false,
          })
          if (cancelled) return
          if (res.success) {
            setFriends(res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })))
            setFriendsStatus('ready')
          } else {
            setFriendsStatus('error')
          }
        } catch {
          if (!cancelled) setFriendsStatus('error')
        }
      })()
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [lineAccountId, search, selectedAccountId])

  const selectedFriend = friends.find((friend) => friend.id === selected) ?? null
  const sendTest = async () => {
    if (!selected) return
    setSending(true)
    setResult(null)
    try {
      const res = stepId
        ? await api.scenarios.testSendStep(scenarioId, stepId, selected)
        : await api.scenarios.testSend(scenarioId, selected)
      setResult(
        res.success
          ? { ok: true, message: `${res.data.sent} 通を送りました。` }
          : { ok: false, message: res.error },
      )
      if (res.success) await loadTestHistory()
    } catch (sendError) {
      setResult({
        ok: false,
        message: sendError instanceof Error ? sendError.message : 'テスト送信に失敗しました。',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Shell
      title="テスト送信"
      description={`${stepLabel}を、選んだ友だちへ実際に送ります。購読の進み具合は変わりません。`}
      // 送り先を選んでいないあいだは送れない。押せる形で置くと、
      // 誰に届くか決まっていないまま本物のLINEが飛ぶ。
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={sending}>
              戻る
            </Button>
            <Button
              variant="primary"
              disabled={!selected || sending}
              onClick={() => void sendTest()}
            >
              {sending ? '送信中…' : 'テスト送信を開始'}
            </Button>
          </>
        ) : (
          <>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
          >
            閉じる
          </button>
          <button
            type="button"
            disabled={!selected || sending}
            onClick={() => setConfirming(true)}
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            内容を確認
          </button>
          </>
        )
      }
    >
      {confirming ? (
        <div className="space-y-4">
          <div className="bg-warning-bg rounded-panel px-4 py-3">
            <p className="text-warning text-sm font-bold">本物のLINEへ送信します</p>
            <p className="text-ink-secondary mt-1 text-xs">送信先と通数を確認してください。送信後は取り消せません。</p>
          </div>
          <dl className="border-hairline rounded-panel divide-hairline divide-y border text-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint">送信先</dt>
              <dd className="text-ink font-bold">{selectedFriend?.displayName || '（名前なし）'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint">送る内容</dt>
              <dd className="text-ink font-bold">{stepLabel}・{steps.length}通</dd>
            </div>
          </dl>
          {steps.length > 0 ? (
            <ul className="border-hairline rounded-panel divide-hairline divide-y border">
              {steps.map((row) => (
                <li key={row.id} className="text-ink-secondary flex items-center gap-3 px-4 py-3 text-xs">
                  <span className="text-ink font-bold">{row.stepOrder}通目</span>
                  <span>{row.timing}</span>
                  <span className="ml-auto">{row.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="border-hairline rounded-panel border px-4 py-3">
            <p className="text-ink text-xs font-bold">確認した内容</p>
            <ul className="text-ink-secondary mt-2 space-y-1 text-xs">
              <li>✓ 対象人数：この友だち1人</li>
              <li>✓ メッセージ表示：全{steps.length}通</li>
              <li>✓ 配信日時：テスト用に待機時間を短縮</li>
            </ul>
          </div>
          <div className="bg-info-bg rounded-panel px-4 py-3">
            <p className="text-ink text-xs font-bold">メッセージプレビュー</p>
            <p className="text-ink-secondary mt-2 text-sm">［テスト］{steps[0]?.kind ?? stepLabel}</p>
          </div>
          <p className="text-ink-faint text-xs">本番の登録は増えません。配信予定も作りません。</p>
        </div>
      ) : (
      <>
      {/*
        設計（g2UNV）の断り。「購読の進み具合は変わりません」だけでは、
        **登録が増えるのか・配信予定が積まれるのか**が読み取れなかった。
        リマインダのテスト送信と同じ言い方でそろえる。
      */}
      <p className="rounded-panel bg-warning-bg text-ink-secondary mb-4 px-4 py-3 text-xs leading-relaxed">
        本物のLINEメッセージが届きます。相手を間違えないでください。下書きの通もテストでは送ります。
        <span className="mt-1 block font-semibold">
          本番の登録は増えません。配信予定も作りません。
        </span>
      </p>

      {lastTest ? (
        <p className="bg-info-bg text-ink-secondary rounded-panel mb-4 px-4 py-3 text-xs">
          前回のテスト送信：{new Date(lastTest.sentAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}・{lastTest.messageCount}通
        </p>
      ) : null}

      {/* 送る内容。押す前に何通いくのかが読めないと、確かめようがない。 */}
      {steps.length > 0 && (
        <div className="border-hairline rounded-panel mb-4 border">
          <div className="border-hairline flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-2.5">
            <p className="text-ink text-xs font-bold">送る内容</p>
            <p className="text-ink-faint text-xs tabular-nums">{steps.length}通</p>
          </div>
          <ul>
            {steps.map((row) => (
              <li
                key={row.id}
                className="border-hairline text-ink-secondary flex flex-wrap items-baseline gap-x-3 border-b px-4 py-2 text-xs last:border-b-0"
              >
                <span className="text-ink shrink-0 tabular-nums">{row.stepOrder}通目</span>
                <span className="shrink-0">{row.timing}</span>
                <span className="min-w-0 flex-1 truncate">{row.kind}</span>
                {/* 1通ごとの結果は返ってこない（口が返すのは送った合計だけ）。
                    合計から1通ずつの成否を作ると、落ちた通が成功に見える。 */}
                <span className="text-ink-faint shrink-0">—</span>
              </li>
            ))}
          </ul>
          <p className="text-ink-faint px-4 py-2 text-xs leading-relaxed">
            1通ずつの結果はまだ繋がっていません。1通ごとの送信結果を返す取得口が接続されると表示されます。
          </p>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="名前で探す"
        className="border-hairline rounded-control text-ink h-10 w-full border px-3 text-sm"
      />
      <div className="border-hairline rounded-panel mt-3 max-h-64 overflow-y-auto border">
        {friendsStatus === 'ready' && friends.map((friend) => (
          <button
            key={friend.id}
            type="button"
            onClick={() => setSelected(friend.id)}
            className={`border-hairline flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm last:border-b-0 ${
              selected === friend.id ? 'bg-accent-soft text-accent font-medium' : 'text-ink'
            }`}
          >
            {friend.displayName || '（名前なし）'}
          </button>
        ))}
        {friendsStatus === 'loading' && (
          <p className="text-ink-faint px-4 py-6 text-center text-sm">友だちを読み込んでいます。</p>
        )}
        {friendsStatus === 'error' && (
          <p className="text-danger px-4 py-6 text-center text-sm">友だちを読み込めませんでした。</p>
        )}
        {friendsStatus === 'ready' && friends.length === 0 && (
          <p className="text-ink-faint px-4 py-6 text-center text-sm">見つかりません</p>
        )}
      </div>
      </>
      )}
      {result && (
        <p
          className={`rounded-panel mt-3 px-4 py-3 text-sm ${
            result.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}
        >
          {result.message}
        </p>
      )}
    </Shell>
  )
}

/** 条件を1行で言い表す。札の中に出す用。 */
export function describeCondition(condition: SegmentCondition | null): string {
  if (isEmptyCondition(condition)) return '条件なし'
  const rules = condition!.rules.length
  const groups = (condition!.groups ?? []).filter((g) => g.rules.length > 0).length
  if (groups === 0) return `${rules} 個の条件`
  return `${rules} 個の条件 ＋ or条件 ${groups} かたまり`
}
