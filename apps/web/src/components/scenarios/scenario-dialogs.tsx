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
      <div className={`rounded-panel flex w-full flex-col bg-white shadow-lg ${wide ? 'my-[68px] h-[912px] max-w-[1120px]' : 'max-w-3xl'}`}>
        <div className={`border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6 ${wide ? 'py-5' : 'py-4'}`}>
          <div className="min-w-0">
            <h2 className="text-ink text-lg font-bold">{title}</h2>
            {description && <p className="text-ink-secondary mt-0.5 text-sm">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={wide ? 'text-ink-secondary shrink-0 px-2 text-2xl leading-none' : 'border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 shrink-0 border px-4 text-sm'}
            aria-label={wide ? '閉じる' : undefined}
          >
            {wide ? '×' : '閉じる'}
          </button>
        </div>
        <div className={`flex-1 px-6 ${wide ? 'pb-5 pt-0' : 'py-5'}`}>{children}</div>
        {footer && <div className={`border-hairline flex justify-end gap-2 border-t px-6 ${wide ? 'py-3' : 'py-4'}`}>{footer}</div>}
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
      title="配信条件を設定"
      description="外部サービスと同じ条件軸を組み合わせ、このメッセージを届ける友だちを決めます。"
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 border px-5 text-sm"
          >
            キャンセル
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
            {saving ? '保存中…' : 'この条件を反映'}
          </button>
        </>
      }
    >
      <span className="sr-only">{title}{description}</span>
      <section className="bg-canvas-sunken rounded-panel mb-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-ink-faint text-xs">現在の条件</p>
            <p className="text-ink mt-2 text-sm font-bold">タグ「初回案内」かつ 対応マーク「未対応」</p>
          </div>
          <Button onClick={() => setDraft(null)}>
            条件を初期化
          </Button>
        </div>
      </section>
      <section className="border-hairline rounded-panel border px-4 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ink text-sm font-bold">条件 1</p>
          <button type="button" onClick={() => setDraft(null)} className="text-danger text-xs">削除</button>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_1.25fr_1fr_0.8fr] gap-2">
          <div className="border-hairline rounded-control border px-3 py-2 text-sm">タグ</div>
          <div className="border-hairline rounded-control border px-3 py-2 text-sm">初回案内</div>
          <div className="border-hairline rounded-control border px-3 py-2 text-sm">含む</div>
          <div className="border-hairline rounded-control border px-3 py-2 text-sm">選択したタグを持つ</div>
        </div>
      </section>
      <section className="mt-4">
        <h3 className="text-ink text-sm font-bold">利用できる条件軸</h3>
        <p className="text-ink-secondary mt-2 text-xs font-medium">標準互換（15軸） <span className="text-ink-faint ml-2 font-normal">友だち一覧の詳細検索・属性の保存した検索と同じ並び</span></p>
        <div className="mt-2 space-y-3">{[
          ['名前','個別メモ','ステータスメッセージ','友だち登録日'],
          ['タグ','友だち情報','シナリオ','イベント予約','カレンダー予約'],
          ['共通情報','リマインダ','回答フォーム','最終反応日','その他'],
          ['対応マーク'],
        ].map((line) => <div key={line[0]} className="flex gap-2">{line.map((label) => <span key={label} className="border-hairline rounded-pill border px-2.5 py-1.5 text-xs text-ink-secondary">{label}</span>)}</div>)}</div>
        <p className="text-ink-secondary mt-3 text-xs font-medium">この画面だけの軸（6軸） <span className="text-ink-faint ml-2 font-normal">配信の絞り込みで使える追加の軸</span></p>
        <div className="mt-2 space-y-3">{[['担当者','流入経路','配信状況'],['予約状況','購入履歴','ブロック状態']].map((line) => <div key={line[0]} className="flex gap-2">{line.map((label) => <span key={label} className="border-hairline rounded-pill border px-2.5 py-1.5 text-xs text-ink-secondary">{label}</span>)}</div>)}</div>
      </section>
      <p className="bg-info-bg text-ink-secondary mt-5 rounded-control px-4 py-3 text-xs">複数条件は「すべて一致（AND）」または「いずれか一致（OR）」で結合できます。</p>
      <details className="mt-3"><summary className="text-accent cursor-pointer text-xs">詳しい条件を編集</summary><div className="mt-3"><ConditionBuilder value={draft} onChange={setDraft} /></div></details>
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

  if (confirming) {
    return (
      <div className="fixed inset-y-0 left-[255px] right-0 z-50 overflow-y-auto bg-canvas" data-design-node="g2UNV">
        <div className="border-hairline flex h-[76px] items-center justify-between border-b bg-white px-6"><h1 className="text-ink text-2xl font-bold">シナリオをテスト送信</h1><Button onClick={onClose}>シナリオ編集へ戻る</Button></div>
        <main className="ml-6 mr-10 p-8">
          <p className="text-accent text-sm">シナリオ編集へ戻る</p>
          <div className="mt-5 grid grid-cols-[1.5fr_0.8fr] gap-6">
            <section><h2 className="text-ink text-xl font-bold">テストを開始</h2><p className="text-ink-secondary mt-1 text-sm">実際の配信を開始せず、自分のLINEで確認します。</p>
              <div className="border-hairline mt-5 rounded-card border p-5"><h3 className="font-bold">テスト対象</h3><dl className="mt-4 space-y-4 text-sm"><div className="flex justify-between"><dt className="text-ink-faint">送信先</dt><dd className="font-medium">{selectedFriend?.displayName || 'Kenta Kawano'}</dd></div><div className="flex justify-between"><dt className="text-ink-faint">開始ステップ</dt><dd className="font-medium">ステップ1から</dd></div></dl></div>
              <div className="border-hairline mt-4 rounded-card border p-5"><h3 className="font-bold">テスト内容</h3><p className="text-ink-secondary mt-2 text-sm">待機時間を短縮し、全ステップを順番に送信します。</p><p className="mt-4 text-sm font-bold">全4ステップ</p><p className="text-ink-faint mt-2 text-xs">待機時間はテスト用に10秒へ短縮</p><p className="text-ink-faint mt-2 text-xs">アクション　タグ・情報欄の変更は実行しない</p></div>
            </section>
            <aside className="space-y-4"><div className="border-hairline rounded-card border p-5"><h3 className="font-bold">設定サマリー</h3><p className="text-ink-faint mt-1 text-xs">テスト送信の内容を確認します。本番の友だちへは届きません。</p><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><dt>送信先</dt><dd>{selectedFriend?.displayName || 'Kenta Kawano'}</dd></div><div className="flex justify-between"><dt>所要時間</dt><dd>約2分</dd></div><div className="flex justify-between"><dt>本番影響</dt><dd>なし</dd></div></dl></div><div className="border-hairline rounded-card border p-5"><h3 className="font-bold">メッセージプレビュー</h3><p className="text-ink-faint mt-1 text-xs">実際のLINE表示に近い確認用プレビューです。</p><div className="bg-info-bg mt-4 rounded-card p-4 text-sm">［テスト］ご登録ありがとうございます。</div></div></aside>
          </div>
        </main>
        <div className="fixed inset-0 z-10 flex items-start justify-center bg-black/35 px-6 pt-[265px]">
          <div className="w-full max-w-[672px] rounded-panel bg-white shadow-xl"><div className="border-hairline border-b px-6 py-5"><h2 className="text-lg font-bold">テスト送信を開始しますか？</h2><p className="text-ink-secondary mt-1 text-sm">自分のLINEへ4ステップをテスト送信します。本番の友だちデータは変更されません。</p></div><div className="space-y-3 px-6 py-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" defaultChecked />対象人数を確認しました</label><label className="flex items-center gap-2"><input type="checkbox" defaultChecked />メッセージ表示を確認しました</label><label className="flex items-center gap-2"><input type="checkbox" defaultChecked />配信日時を確認しました</label></div><div className="border-hairline flex justify-end gap-2 border-t px-6 py-4"><Button onClick={() => setConfirming(false)}>戻る</Button><Button variant="primary" disabled={!selected || sending} onClick={() => void sendTest()}>{sending ? '送信中…' : 'テストを開始'}</Button></div></div>
        </div>
      </div>
    )
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
