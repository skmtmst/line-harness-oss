'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type {
  AutoReplyConflict,
  AutoReplyDraftVersion,
  AutoReplyDryRunResult,
  AutoReplyPublishResult,
  AutoReplyValidationResult,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StepTrail from '@/components/shared/step-trail'
import SummaryCard from '@/components/shared/summary-card'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ApiError, api } from '@/lib/api'
import { canPublish, conflictTone, publishGates, type PublishStage } from './publish-flow'

/** 段の名前。設計の `U9hzqH` → `g46ja` → `Yj6CQ` → `e6iJG`。 */
const STAGES: Array<{ key: PublishStage; label: string; node: string }> = [
  { key: 'conflicts', label: '重なりを確認', node: 'U9hzqH' },
  { key: 'test', label: '実際に試す', node: 'g46ja' },
  { key: 'confirm', label: '最後の確認', node: 'Yj6CQ' },
  { key: 'done', label: '公開しました', node: 'e6iJG' },
]

/** 試験で当たらなかった理由。**内部の記号を画面へ出さない。** */
const REASON_LABELS: Record<string, string> = {
  message_kind_not_matched: 'メッセージの種類が違います',
  keyword_not_matched: 'キーワードに当たりません',
  outside_active_window: '受け付ける時間帯の外です',
  weekday_not_allowed: 'この曜日は受け付けません',
  operator_handling: '担当者が対応中です',
  already_replied_once: 'この友だちへは一度返しています',
  cooldown_active: '前回の返信から間を空けています',
  friend_conditions_not_met: '友だちの条件に当てはまりません',
}

const RESULT_LABELS: Record<string, string> = {
  won: 'これが返します',
  skipped: '見送りました',
  not_matched: '当たりませんでした',
}

function AutoReplyPublishInner() {
  usePageTitle('自動応答を公開する')
  const params = useSearchParams()
  const autoReplyId = params.get('id') ?? ''

  const [stage, setStage] = useState<PublishStage>('conflicts')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading')
  const [draft, setDraft] = useState<AutoReplyDraftVersion | null>(null)
  const [conflicts, setConflicts] = useState<AutoReplyConflict[]>([])
  const [validation, setValidation] = useState<AutoReplyValidationResult | null>(null)
  const [dryRun, setDryRun] = useState<AutoReplyDryRunResult | null>(null)
  const [published, setPublished] = useState<AutoReplyPublishResult | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    if (!autoReplyId) return
    setLoadState('loading')
    try {
      const [draftRes, conflictRes] = await Promise.all([
        api.autoReplies.getDraft(autoReplyId),
        api.autoReplies.conflicts(autoReplyId),
      ])
      if (!draftRes.success || !conflictRes.success) throw new Error('load failed')
      /*
        **形が違う返事を、そのまま画面へ流さない。**
        口の契約は下書き1件（`apps/worker/src/routes/auto-replies.ts:810`）だが、
        器だけ違うものが来ると `draft.settings.name` で落ち、**この面が
        白い画面になる**。読めなかったこととして扱えば、理由と読み直しの口が出る。
      */
      if (!draftRes.data?.settings) throw new Error('draft_shape')
      setDraft(draftRes.data)
      setConflicts(Array.isArray(conflictRes.data?.conflicts) ? conflictRes.data.conflicts : [])
      setLoadState('ready')
    } catch (cause) {
      /*
        **権限不足を「読めなかった」と混ぜない。**403 は運用者の側で
        できることが違う（人に頼む）ので、別の文を出す。
      */
      setLoadState(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
    }
  }, [autoReplyId])

  useEffect(() => { void load() }, [load])

  const gates = useMemo(
    () => publishGates(validation, dryRun, acknowledged),
    [validation, dryRun, acknowledged],
  )
  const ready = canPublish(gates)

  const run = async (what: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setActionError('')
    try {
      await fn()
    } catch {
      setActionError(`${what}できませんでした。状態を読み直してから、もう一度お試しください。`)
    } finally {
      setBusy(false)
    }
  }

  if (loadState === 'loading') return <ListState kind="loading" />
  if (loadState === 'denied') {
    return (
      <ListState
        kind="error"
        title="この自動応答を公開する権限がありません"
        description="下書きの中身も表示していません。担当者に公開を依頼してください。"
      />
    )
  }
  if (loadState === 'error' || !draft) {
    return (
      <ListState
        kind="error"
        title="下書きを表示できませんでした"
        description="保存した下書きは消えていません。状態を読み直して、もう一度お試しください。"
        action={<Button onClick={() => void load()}>再読み込み</Button>}
      />
    )
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage)

  return (
    <div className="space-y-4" data-design-node={STAGES[stageIndex]?.node}>
      <nav className="text-ink-faint text-xs">
        <Link href="/auto-replies" className="hover:underline">自動応答</Link>
        <span className="mx-1.5">/</span>
        <span>{draft.settings.name}</span>
        <span className="mx-1.5">/</span>
        <span>公開する</span>
      </nav>

      <StepTrail
        label="自動応答を公開する進み方"
        items={STAGES.map((s, i) => ({
          label: s.label,
          state: i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'todo',
        }))}
      />

      <Notice tone="validation" message={`公開するまで、いまお客様へ返している内容は変わりません。ここで確かめているのは
        下書き（第${draft.versionNumber}版）です。`} />

      {actionError ? <Notice tone="error" message={actionError} /> : null}

      {stage === 'conflicts' ? (
        <Card>
          <CardHeader title="重なりを確認" meta="同じ言葉を受けている自動応答です。上にあるものが先に返します。" />
          {conflicts.length === 0 ? (
            <ListState kind="empty" title="重なる自動応答はありません" description="この下書きだけが当たります。" />
          ) : (
            <ul className="divide-hairline divide-y">
              {conflicts.map((c) => {
                const tone = conflictTone(c, draft.autoReplyId)
                const checked = acknowledged.has(c.autoReplyId)
                return (
                  <li key={c.autoReplyId} className="flex items-start gap-3 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`${c.name}の重なりを確認した`}
                      onChange={() => {
                        setAcknowledged((prev) => {
                          const next = new Set(prev)
                          if (next.has(c.autoReplyId)) next.delete(c.autoReplyId)
                          else next.add(c.autoReplyId)
                          return next
                        })
                      }}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <p className="text-ink text-sm font-medium">
                        {c.name}
                        <span className={`ml-2 text-xs ${tone.losing ? 'text-warning' : 'text-ink-faint'}`}>
                          {tone.label}
                          {tone.losing ? '・この下書きより先に返します' : '・この下書きが先に返します'}
                        </span>
                      </p>
                      <p className="text-ink-faint mt-0.5 text-xs">{c.reason}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="border-hairline mt-4 flex justify-end gap-2 border-t pt-4">
            <Button
              data-qa-open="g46ja"
              variant="primary"
              disabled={busy || acknowledged.size !== conflicts.length}
              onClick={() => setStage('test')}
            >
              確認したので次へ
            </Button>
          </div>
        </Card>
      ) : null}

      {stage === 'test' ? (
        <Card>
          <CardHeader title="実際に試す" meta="本番と同じ順番・条件で試します。LINEへの送信、タグの変更、状態の更新はしません。" />
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard variant="v6" title="当たったか" value={null} unit="" detail={dryRun ? (dryRun.matched ? '当たりました' : '当たりませんでした') : '—（未取得）まだ試していません'} />
            <SummaryCard variant="v6" title="この下書きが返すか" value={null} unit="" detail={dryRun ? (dryRun.draftWon ? 'この下書きが返します' : `いまは「${dryRun.winner?.name ?? '別の自動応答'}」が返します`) : '—（未取得）まだ試していません'} />
            <SummaryCard variant="v6" title="状態の変化" value={null} unit="" detail="ありません（試すだけです）" />
          </div>

          {dryRun ? (
            <div className="mt-4">
              <p className="text-ink-secondary mb-2 text-xs font-medium">評価の順番と結果</p>
              <ul className="divide-hairline divide-y text-sm">
                {dryRun.candidates.map((c) => (
                  <li key={c.autoReplyId} className="flex items-start justify-between gap-3 py-2">
                    <span className="text-ink">{c.priority}. {c.name}</span>
                    <span className="text-right">
                      <span className={c.result === 'won' ? 'text-success' : 'text-ink-faint'}>
                        {RESULT_LABELS[c.result] ?? c.result}
                      </span>
                      {c.reasonCodes.length ? (
                        <span className="text-ink-faint block text-xs">
                          {c.reasonCodes.map((r) => REASON_LABELS[r] ?? r).join(' / ')}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-hairline mt-4 flex justify-end gap-2 border-t pt-4">
            <Button onClick={() => setStage('conflicts')} disabled={busy}>戻る</Button>
            <Button
              disabled={busy}
              onClick={() => void run('試', async () => {
                const res = await api.autoReplies.testDraft(autoReplyId, {
                  friendId: 'friend-1',
                  incomingText: '営業時間は何時からですか',
                })
                if (!res.success) throw new Error('test failed')
                setDryRun(res.data)
              })}
            >
              {busy ? '試しています…' : '実際に試す'}
            </Button>
            <Button
              data-qa-open="Yj6CQ"
              variant="primary"
              disabled={busy || !dryRun}
              onClick={() => void run('確認', async () => {
                const res = await api.autoReplies.validateDraft(autoReplyId)
                if (!res.success) throw new Error('validate failed')
                setValidation(res.data)
                setStage('confirm')
              })}
            >
              最後の確認へ
            </Button>
          </div>
        </Card>
      ) : null}

      {stage === 'confirm' ? (
        <Card>
          <CardHeader title="最後の確認" meta="ここで公開すると、次に届くメッセージから新しい内容で返します。" />
          <ul className="space-y-2 text-sm">
            {gates.map((g) => (
              <li key={g.label} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={g.state === 'ok' ? 'text-success' : g.state === 'blocked' ? 'text-warning' : 'text-ink-faint'}
                >
                  {g.state === 'ok' ? '✓' : g.state === 'blocked' ? '!' : '—'}
                </span>
                <span>
                  <span className="text-ink block">{g.label}</span>
                  <span className="text-ink-faint block text-xs">{g.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-ink-faint mt-3 text-xs">
            「—」は、この画面から確かめられない項目です。確認済みとしては扱いません。
          </p>
          {validation?.warnings.length ? (
            <Notice tone="validation" message={`{validation.warnings.join(' / ')}`} />
          ) : null}
          <div className="border-hairline mt-4 flex justify-end gap-2 border-t pt-4">
            <Button onClick={() => setStage('test')} disabled={busy}>戻る</Button>
            <Button
              variant="primary"
              disabled={busy || !ready}
              title={ready ? undefined : '上の確認がすべて済むまで公開できません'}
              onClick={() => void run('公開', async () => {
                /*
                  **二重公開を止める。**同じ鍵で送れば、押し直しても
                  version が増えない（契約の `Idempotency-Key`）。
                */
                const key = `${autoReplyId}:${draft.versionId}`
                const res = await api.autoReplies.publishDraft(
                  autoReplyId,
                  { acknowledgedConflictIds: [...acknowledged] },
                  key,
                )
                if (!res.success) throw new Error('publish failed')
                setPublished(res.data)
                setStage('done')
              })}
            >
              {busy ? '公開しています…' : 'この内容で公開する'}
            </Button>
          </div>
        </Card>
      ) : null}

      {stage === 'done' && published ? (
        <Card>
          <CardHeader title="公開しました" meta="次に届くメッセージから、新しい内容で返します。" />
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard variant="v6" title="公開した版" value={published.versionNumber} unit="版" detail="この版は書き換えられません" />
            <SummaryCard variant="v6" title="確認した重なり" value={published.acknowledgedConflictIds.length} unit="件" detail="公開前に確かめた数" />
            <SummaryCard variant="v6" title="すでに届いた分" value={null} unit="" detail="—（未取得）公開前の返信はそのまま残ります" />
          </div>
          <Notice tone="validation" message={`公開より前に届いたメッセージへの返信は、前の版のままです。あとから書き換わることはありません。`} />
          {/*
            **行き先の無いリンクを置かない。** 実行の記録の画面
            （`/auto-replies/runs`、設計 8-1-H `t7UtYQ`）はまだ入っていない
            （台帳 Issue #65）。押せる形で置くと、押した人は行き止まりに当たる。
            何がどうなれば見られるかを文字で書く。
          */}
          <p className="text-ink-faint mt-4 text-xs">
            実行の記録の画面はまだ繋がっていません。接続されると、この版が実際に
            どう返信したかをここから確認できます。
          </p>
          <div className="border-hairline mt-4 flex justify-end gap-2 border-t pt-4">
            <Button href="/auto-replies" variant="primary">一覧へ戻る</Button>
          </div>
        </Card>
      ) : null}
    </div>
  )
}

export default function AutoReplyPublishPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <AutoReplyPublishInner />
    </Suspense>
  )
}
