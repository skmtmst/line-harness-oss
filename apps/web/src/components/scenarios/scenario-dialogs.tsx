'use client'

/*
 * シナリオ詳細で使う小さな窓。
 *
 * 詳細画面は既に長いので、窓の中身はここに分けてある。1ファイルに足すと
 * 「どこを直すと何が変わるか」が追えなくなる。
 */

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import ConditionBuilder, {
  isEmptyCondition,
  type SegmentCondition,
} from '@/components/shared/condition-builder'

function Shell({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="rounded-card w-full max-w-3xl bg-white shadow-lg">
        <div className="border-line flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-ink text-lg font-bold">{title}</h2>
            {description && <p className="text-ink-secondary mt-0.5 text-sm">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-line text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 shrink-0 border px-4 text-sm"
          >
            閉じる
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="border-line flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
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
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="border-line text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
          >
            やめる
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              await onSave(draft)
              setSaving(false)
              onClose()
            }}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : 'この条件にする'}
          </button>
        </>
      }
    >
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
            className="border-line text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
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
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : '変更する'}
          </button>
        </>
      }
    >
      {error && <p className="rounded-card bg-danger-soft text-danger mb-4 px-4 py-3 text-sm">{error}</p>}
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
            className={`rounded-card flex cursor-pointer gap-3 border p-4 ${
              draftMode === opt.value ? 'border-accent bg-accent-soft' : 'border-line'
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

      <div className="border-line mt-5 border-t pt-5">
        <p className="text-ink text-sm font-bold">その他のアクション</p>
        <p className="text-ink-secondary mt-0.5 mb-2 text-xs">
          配り終えた人に対して、タグ・友だち情報・対応マークなどを動かします。
        </p>
        <button
          type="button"
          onClick={onOpenActions}
          className="border-line text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-4 text-sm"
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
            className="border-line rounded-control text-ink mt-1.5 h-10 w-full border bg-white px-3 text-sm"
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

export function TestSendDialog({
  scenarioId,
  stepId,
  stepLabel,
  onClose,
}: {
  scenarioId: string
  /** null なら全通を送る。 */
  stepId: string | null
  stepLabel: string
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState<{ id: string; displayName: string | null }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const res = await api.friends.list({ limit: 20, search, includeTags: false })
        if (res.success) {
          setFriends(res.data.items.map((f) => ({ id: f.id, displayName: f.displayName })))
        }
      })()
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <Shell
      title="テスト送信"
      description={`${stepLabel}を、選んだ友だちへ実際に送ります。購読の進み具合は変わりません。`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="border-line text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
          >
            閉じる
          </button>
          <button
            type="button"
            disabled={!selected || sending}
            onClick={async () => {
              if (!selected) return
              setSending(true)
              setResult(null)
              const res = stepId
                ? await api.scenarios.testSendStep(scenarioId, stepId, selected)
                : await api.scenarios.testSend(scenarioId, selected)
              setSending(false)
              setResult(
                res.success
                  ? { ok: true, message: `${res.data.sent} 通を送りました。` }
                  : { ok: false, message: res.error },
              )
            }}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            {sending ? '送信中…' : '送る'}
          </button>
        </>
      }
    >
      <p className="rounded-card bg-warning-soft text-ink-secondary mb-4 px-4 py-3 text-xs">
        本物のLINEメッセージが届きます。相手を間違えないでください。下書きの通もテストでは送ります。
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="名前で探す"
        className="border-line rounded-control text-ink h-10 w-full border px-3 text-sm"
      />
      <div className="border-line rounded-card mt-3 max-h-64 overflow-y-auto border">
        {friends.map((friend) => (
          <button
            key={friend.id}
            type="button"
            onClick={() => setSelected(friend.id)}
            className={`border-line flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm last:border-b-0 ${
              selected === friend.id ? 'bg-accent-soft text-accent font-medium' : 'text-ink'
            }`}
          >
            {friend.displayName || '（名前なし）'}
          </button>
        ))}
        {friends.length === 0 && (
          <p className="text-ink-faint px-4 py-6 text-center text-sm">見つかりません</p>
        )}
      </div>
      {result && (
        <p
          className={`rounded-card mt-3 px-4 py-3 text-sm ${
            result.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
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
