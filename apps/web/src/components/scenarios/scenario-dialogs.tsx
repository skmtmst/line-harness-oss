'use client'

/*
 * シナリオ詳細で使う小さな窓。
 *
 * 詳細画面は既に長いので、窓の中身はここに分けてある。1ファイルに足すと
 * 「どこを直すと何が変わるか」が追えなくなる。
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type ScenarioFriendPlan, type ScenarioFriendPlanStep } from '@/lib/api'
import { scenarioReferenceData } from './scenario-reference-data'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConditionBuilder, {
  isEmptyCondition,
  isRuleComplete,
  pruneCondition,
  type SegmentCondition,
  type SegmentRule,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}>
      <div className="rounded-panel flex w-full flex-col shadow-lg" style={wide ? { marginBlock: 68, height: 912, maxWidth: 1120, background: 'var(--color-canvas)' } : { maxWidth: '48rem', background: 'var(--color-canvas)' }}>
        <div className={`border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6 ${wide ? 'py-5' : 'py-4'}`}>
          <div className="min-w-0">
            <h2 className="text-ink text-lg font-bold">{title}</h2>
            {description && <p className="text-ink-secondary mt-0.5 text-sm">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-secondary shrink-0 px-2 text-2xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        <div className={`flex-1 px-6 ${wide ? 'pb-5 pt-0' : 'py-5'}`}>{children}</div>
        {footer && <div className={`border-hairline flex justify-end gap-2 border-t px-6 ${wide ? 'py-3' : 'py-4'}`}>{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- 配信対象 */

/*
 * 「現在の条件」の行に出す条件軸の名前。
 *
 * 窓の中で条件の中身を要約するときに使う。下の「詳しい条件を編集」
 * （ConditionBuilder）が見ている draft と同じ値から組み立てる。
 * 固定の見本を置くと、書いた条件と表示が食い違う（#616 SC-02c）。
 */
const RULE_TYPE_LABEL: Record<string, string> = {
  name: '名前',
  private_memo: '個別メモ',
  status_message: 'ステータスメッセージ',
  registered_at: '友だち登録日',
  support_mark: '対応マーク',
  tag_exists: 'タグ',
  tag_all: 'タグ',
  tag_not_exists: 'タグ（除外）',
  tag_not_all: 'タグ（除外）',
  friend_field: '友だち情報',
  scenario_subscribed: 'シナリオ購読',
  scenario_state: 'シナリオ',
  form_answered: '回答フォーム',
  last_reaction_at: '最終反応日',
  reaction_state: '反応状態',
  score_range: '行動スコア',
  is_following: 'ブロック状態',
  is_hidden: '表示状態',
  analytics_audience: '一時対象者',
  ref_code: '紹介コード',
}

/** 条件1行の読み取り。軸の名前だけはIDなしで確実に言える。 */
function describeRule(rule: SegmentRule): string {
  const label = RULE_TYPE_LABEL[rule.type] ?? rule.type
  return isRuleComplete(rule) ? label : `${label}（書きかけ）`
}

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
  const [error, setError] = useState('')

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
              setError('')
              try {
                // 書きかけの行は落として保存する。残すと、誰にも一致しない
                // 条件になって配信が黙って止まる。
                await onSave(pruneCondition(draft))
                onClose()
              } catch {
                /*
                 * 呼び出し側の保存が例外で落ちても「保存中」のままにしない
                 * （SCENARIO-05）。窓は開いたまま、下書きも残す。
                 */
                setError('条件を保存できませんでした。通信状態を確認して、もう一度お試しください。')
              } finally {
                setSaving(false)
              }
            }}
            className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '保存中…' : 'この条件を反映'}
          </button>
        </>
      }
    >
      {error && (
        <p className="rounded-panel bg-danger-bg text-danger mb-4 px-4 py-3 text-sm">{error}</p>
      )}
      <span className="sr-only">{title}{description}</span>
      <section className="bg-canvas-sunken rounded-panel mb-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-ink-faint text-xs">現在の条件</p>
            {/*
              実際の下書き（draft）を言い表す。下の「詳しい条件を編集」が
              見ているのと同じ値なので、ここだけ別の条件に見えることはない。
            */}
            <p className="text-ink mt-2 text-sm font-bold">{describeCondition(draft)}</p>
          </div>
          <Button onClick={() => setDraft(null)}>
            条件を初期化
          </Button>
        </div>
      </section>
      <section className="border-hairline rounded-panel border px-4 py-5">
        {draft && !isEmptyCondition(draft) ? (
          <ul className="space-y-2">
            {draft.rules.map((rule, i) => (
              <li key={`rule-${i}`} className="flex items-center justify-between gap-3">
                <p className="text-ink text-sm font-bold">
                  条件 {i + 1}
                  <span className="text-ink-secondary ml-2 text-xs font-normal">
                    {describeRule(rule)}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...draft, rules: draft.rules.filter((_, r) => r !== i) }
                    setDraft(isEmptyCondition(next) ? null : next)
                  }}
                  className="text-danger shrink-0 text-xs"
                >
                  削除
                </button>
              </li>
            ))}
            {(draft.groups ?? []).map((group, gi) => (
              <li key={`group-${gi}`} className="flex items-center justify-between gap-3">
                <p className="text-ink text-sm font-bold">
                  or条件のかたまり {gi + 1}
                  <span className="text-ink-secondary ml-2 text-xs font-normal">
                    {group.rules.length}件
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const next = {
                      ...draft,
                      groups: (draft.groups ?? []).filter((_, g) => g !== gi),
                    }
                    setDraft(isEmptyCondition(next) ? null : next)
                  }}
                  className="text-danger shrink-0 text-xs"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-secondary text-sm">
            条件はまだありません。下の「詳しい条件を編集」から足せます。
          </p>
        )}
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
  const { selectedAccountId } = useAccount()
  /*
   * SCENARIO-14: 移動先の候補は対象シナリオのアカウントで絞る。
   * 無指定で全権限範囲を取ると別アカウントのシナリオが候補に混ざり、
   * 200件の打ち切りで本命が見えなくなる。
   * 状態は loading/ready/error で持ち、失敗を0件扱いしない。
   */
  const [candidatesState, setCandidatesState] = useState<'loading' | 'ready' | 'error'>('loading')
  /** 保存済みの移動先が候補に無いとき、名前だけでも示すための取得結果。 */
  const [savedTargetName, setSavedTargetName] = useState<string | null>(null)
  const [savedTargetMissing, setSavedTargetMissing] = useState(false)

  const loadCandidates = useCallback(async (isStale: () => boolean) => {
    setCandidatesState('loading')
    setSavedTargetMissing(false)
    try {
      /*
       * まず対象シナリオのアカウントを知る。共通シナリオ
       * （lineAccountId が null）では、いま選んでいるアカウントの
       * 候補を出す（意図的な仕様：共通シナリオの移動先は
       * 閲覧中アカウントの範囲で選ぶ）。
       */
      const me = await scenarioReferenceData.scenario(scenarioId)
      if (!me.success) throw new Error('scenario fetch failed')
      const accountId = me.data.lineAccountId ?? selectedAccountId ?? undefined

      // 200件を超える分も全ページ取る。打ち切りで候補が欠けないように。
      const items: { id: string; name: string }[] = []
      let page = 1
      let total = Number.POSITIVE_INFINITY
      while (items.length < total && page <= 50) {
        const res = await api.scenarios.listPage({ accountId, page, limit: 200 })
        if (!res.success) throw new Error(res.error)
        items.push(...res.data.items.map((s) => ({ id: s.id, name: s.name })))
        total = res.data.total
        if (res.data.items.length === 0) break
        page += 1
      }
      if (isStale()) return
      const candidates = items.filter((s) => s.id !== scenarioId)
      setScenarios(candidates)

      /*
       * 保存済みの移動先が候補に無い（別アカウント・削除済み・権限外）
       * ことがある。黙って選択を外すと保存値が消えたように見えるので、
       * 個別に取って「現在の保存値」として選択肢へ足す。
       */
      if (targetScenarioId && !candidates.some((s) => s.id === targetScenarioId)) {
        const saved = await api.scenarios.get(targetScenarioId).catch(() => null)
        if (isStale()) return
        setSavedTargetMissing(true)
        setSavedTargetName(saved?.success ? saved.data.name : null)
      }
      setCandidatesState('ready')
    } catch {
      if (!isStale()) setCandidatesState('error')
    }
  }, [scenarioId, selectedAccountId, targetScenarioId])

  useEffect(() => {
    let stale = false
    void loadCandidates(() => stale)
    return () => {
      stale = true
    }
  }, [loadCandidates])

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
              try {
                const err = await onSave(draftMode, draftMode === 'move' ? draftTarget : null)
                if (err) {
                  setError(err)
                  return
                }
                onClose()
              } catch {
                /*
                 * onSave が業務失敗を返す形と、例外で落ちる形の両方がある。
                 * 例外でも「保存中」のままにしない（SCENARIO-05）。
                 */
                setError('保存できませんでした。通信状態を確認して、もう一度お試しください。')
              } finally {
                setSaving(false)
              }
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
              // 設計（g6qn3）が「状態」の札に置いていた説明は、実はこの
              // 割り込み→復帰の動きのこと。別のシナリオを割り込みで開始
              // すると流れていたシナリオは止まり、ここを選ぶと止まった
              // 続きから戻る。同時購読の札（U007）からは外した。
              hint: '別のシナリオを開始すると、いま流れているシナリオは停止します。あとで戻すと、止まった続きから再開します。複数の流れを同時に届けたい場合は、1つのシナリオ内で分岐させてください。このシナリオを割り込みで始めた人を、元のシナリオの続きへ戻します。控えが無い人は止まったままです。',
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
          <label className="text-ink text-sm font-medium" htmlFor="on-complete-move-target">
            移動先のシナリオ
          </label>
          {/*
            SCENARIO-14: 候補の取得失敗は「0件」と分けて再試行を出す。
            保存済みの移動先が候補に無いときは、現在の保存値として
            選択肢に残し、理由を脇に書く。
          */}
          {candidatesState === 'error' ? (
            <p className="text-danger mt-1.5 flex flex-wrap items-center gap-3 text-sm" role="alert">
              移動先の候補を読み込めませんでした。
              <button
                type="button"
                className="text-info font-medium hover:underline"
                onClick={() => void loadCandidates(() => false)}
              >
                もう一度読み込む
              </button>
            </p>
          ) : (
            <>
              <select
                id="on-complete-move-target"
                value={draftTarget ?? ''}
                onChange={(e) => setDraftTarget(e.target.value || null)}
                disabled={candidatesState === 'loading'}
                className="border-hairline rounded-control text-ink mt-1.5 h-10 w-full border bg-white px-3 text-sm"
              >
                <option value="">
                  {candidatesState === 'loading' ? '候補を読み込んでいます' : '選んでください'}
                </option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {savedTargetMissing && targetScenarioId ? (
                  <option value={targetScenarioId}>
                    {savedTargetName ?? '現在の保存値（名前を取得できません）'}
                  </option>
                ) : null}
              </select>
              {savedTargetMissing ? (
                <p className="text-warning mt-1.5 text-xs">
                  保存されている移動先はこのアカウントの候補にありません（別アカウント・削除済み・権限外の可能性）。そのまま保存すると現在の値が維持されます。
                </p>
              ) : null}
            </>
          )}
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

/*
 * #987 NEXT-01〜04：最終確認の虚偽を直す。
 *
 * 旧版は「自分のLINE」「本番の友だちへは届きません」「ステップ1から」
 * 「約2分」「待機10秒に短縮」と固定で書いていたが、実際は選んだ任意の
 * 友だちへ実送信し、Worker は待機を挟まず各通を順に push するだけ。
 * 確認は選んだ通・実本文・送信先から組み立てる。
 */

/**
 * 確認画面に出す本文の差し込み。Worker は name 以外にも多くの変数を
 * 埋めるが、ここでは選んだ相手から確実に分かる値だけを埋め、残りは
 * そのまま見せる（架空の値で埋めて「本物どおり」に見せない）。
 */
function expandTestPreviewBody(
  content: string,
  friend: { id: string; displayName: string | null } | null,
): string {
  if (!friend) return content
  return content
    .replace(/\{\{name\}\}/g, friend.displayName || '')
    .replace(/\{\{friend_id\}\}/g, friend.id)
}

/** メッセージ種別の表示名（呼び出し側の kind が無い fallback 用）。 */
const TEST_MESSAGE_TYPE_LABEL: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex（カードタイプ）',
  sticker: 'スタンプ',
  location: '位置情報',
  video: '動画',
  audio: '音声',
  carousel: 'カルーセル',
}

/** 最終確認で本当に必要なチェックの数。文言は選択した相手の名前を含めて組み立てる。 */
const REQUIRED_CONFIRMATION_COUNT = 2

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
  const { selectedAccountId, accounts } = useAccount()
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState<{ id: string; displayName: string | null }[]>([])
  const [friendsStatus, setFriendsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; partial?: boolean; message: string } | null>(null)
  const [lastTest, setLastTest] = useState<{ sentAt: string; messageCount: number } | null>(null)
  // NEXT-02: 送信可否に結ぶ確認。未チェックから始め、相手が変わればやり直す。
  const [confirmChecks, setConfirmChecks] = useState<boolean[]>(() =>
    Array(REQUIRED_CONFIRMATION_COUNT).fill(false),
  )
  // NEXT-01: 送信先が本人連携・テスト受信者・一般のどれかを直前に固定表示する。
  const [recipientClass, setRecipientClass] = useState<
    'loading' | 'staff' | 'test' | 'general' | 'error'
  >('loading')
  const [staffName, setStaffName] = useState<string | null>(null)
  // NEXT-04: 実本文は preview 口から取る（配信と同じテンプレート解決を通る）。
  const [stepBodies, setStepBodies] = useState<
    Record<number, { messageType: string; content: string }>
  >({})
  const [bodiesStatus, setBodiesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
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

  /*
   * NEXT-02: 送信先や対象の通が変わったら確認はやり直し。付けっぱなしの
   * チェックを別の相手へ持ち越すと「確認しました」が嘘になる。
   * （確認画面を開いているあいだは送信先を選び直せないので、ここは
   * 防御的なリセット。実際のリセットは openConfirm でも行う。）
   */
  useEffect(() => {
    setConfirmChecks(Array(REQUIRED_CONFIRMATION_COUNT).fill(false))
  }, [selected, stepId])

  /*
   * NEXT-01/NEXT-04: 最終確認を開いたとき、送信先の区分と実本文を取る。
   * 区分は「スタッフ連携（本人など）→ テスト受信者 → 一般の友だち」の順で
   * 判定し、取れなければ取れなかったと書く。
   */
  useEffect(() => {
    if (!confirming) return
    let cancelled = false
    setRecipientClass('loading')
    setStaffName(null)
    setBodiesStatus('loading')
    void (async () => {
      try {
        if (resolvedAccountId && selected) {
          const [loginUsers, testRecipients] = await Promise.all([
            api.accountSettings.getTestRecipientLoginUsers(resolvedAccountId),
            api.accountSettings.getTestRecipients(resolvedAccountId),
          ])
          if (!cancelled) {
            if (!loginUsers.success || !testRecipients.success) {
              setRecipientClass('error')
            } else {
              const staff = loginUsers.data.find((u) => u.id === selected)
              if (staff) {
                setStaffName(staff.staffName)
                setRecipientClass('staff')
              } else if (testRecipients.data.some((r) => r.id === selected)) {
                setRecipientClass('test')
              } else {
                setRecipientClass('general')
              }
            }
          }
        } else if (!cancelled) {
          setRecipientClass('error')
        }
      } catch {
        if (!cancelled) setRecipientClass('error')
      }
      try {
        const res = await api.scenarios.preview(scenarioId)
        if (cancelled) return
        if (!res.success) {
          setBodiesStatus('error')
          return
        }
        const map: Record<number, { messageType: string; content: string }> = {}
        for (const s of res.data.steps) {
          map[s.stepOrder] = { messageType: s.messageType, content: s.messageContent }
        }
        setStepBodies(map)
        setBodiesStatus('ready')
      } catch {
        if (!cancelled) setBodiesStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [confirming, selected, resolvedAccountId, scenarioId])

  const selectedFriend = friends.find((friend) => friend.id === selected) ?? null
  const friendName = selectedFriend?.displayName || '（名前なし）'
  const accountName =
    (resolvedAccountId ? (accounts ?? []).find((a) => a.id === resolvedAccountId)?.name : null) ??
    null
  const allConfirmed =
    confirmChecks.length === REQUIRED_CONFIRMATION_COUNT && confirmChecks.every(Boolean)
  // 最終確認で本当に必要なチェックだけ。人数や日時はテスト送信に無いので
  // チェック項目にしない（確認文としては残す）。
  const requiredConfirmations = [
    `送信先が「${friendName}」さんで間違いないことを確認しました`,
    '届くメッセージの内容を確認しました',
  ]
  const recipientLabel =
    recipientClass === 'staff'
      ? `スタッフ連携のLINE（${staffName ?? '担当者'}）`
      : recipientClass === 'test'
        ? 'テスト受信者'
        : recipientClass === 'general'
          ? '一般の友だち'
          : recipientClass === 'error'
            ? '区分を確認できませんでした'
            : '確認しています'
  // 送る通。呼び出し側から steps が来ないときは preview の実データで組み立てる。
  const confirmSteps =
    steps.length > 0
      ? steps.map((row) => ({ stepOrder: row.stepOrder, timing: row.timing, kind: row.kind }))
      : Object.entries(stepBodies)
          .map(([order, body]) => ({
            stepOrder: Number(order),
            timing: '',
            kind: TEST_MESSAGE_TYPE_LABEL[body.messageType] ?? body.messageType,
          }))
          .sort((a, b) => a.stepOrder - b.stepOrder)

  const openConfirm = () => {
    setConfirmChecks(Array(REQUIRED_CONFIRMATION_COUNT).fill(false))
    setResult(null)
    setConfirming(true)
  }

  const sendTest = async () => {
    if (!selected || sending) return
    setSending(true)
    setResult(null)
    try {
      const res = stepId
        ? await api.scenarios.testSendStep(scenarioId, stepId, selected)
        : await api.scenarios.testSend(scenarioId, selected)
      if (res.success) {
        // sent は「通」ではなくLINEメッセージ数。選んだ通より少ないときは
        // 一部しか届いていない可能性として扱う。
        const partial = res.data.sent < Math.max(confirmSteps.length, 1)
        setResult(
          partial
            ? {
                ok: false,
                partial: true,
                message: `${res.data.sent} 件のメッセージだけ届きました。残りは送れていない可能性があります。`,
              }
            : { ok: true, message: `${res.data.sent} 件のメッセージを送りました。` },
        )
        if (!partial) await loadTestHistory()
      } else {
        setResult({ ok: false, message: res.error })
      }
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
    /*
     * #985 CHK-01: 左の空きはPCのメニュー（1280px以上で256px）が
     * 実在するときだけ取る。狭い幅では全幅にしないと、確認の本文と
     * 操作が残った細い帯に潰れて読めない。
     */
    return (
      <div className="fixed inset-y-0 right-0 left-0 z-50 overflow-y-auto bg-canvas xl:left-64" data-design-node="g2UNV">
        <div className="border-hairline flex flex-wrap items-center justify-between gap-2 border-b px-6" style={{ minHeight: 76, background: 'var(--color-canvas)' }}><h1 className="text-ink text-2xl font-bold">シナリオをテスト送信</h1><Button onClick={onClose}>シナリオ編集へ戻る</Button></div>
        <main className="ml-6 mr-10 p-8">
          <p className="text-accent text-sm">シナリオ編集へ戻る</p>
          {/* #1015 CHK-01 残存対応: 2列の固定比は狭い幅で本文が潰れるので、lg未満は1列に畳む。 */}
          <div className="mt-5 grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
            <section><h2 className="text-ink text-xl font-bold">選択した1名へ実際に送信</h2><p className="text-ink-secondary mt-1 text-sm">選んだ友だちのLINEへ、実際のメッセージが届きます。操作者専用の宛先ではありません。</p>
              <div className="border-hairline mt-5 rounded-panel border p-5"><h3 className="font-bold">テスト対象</h3><dl className="mt-4 space-y-4 text-sm"><div className="flex justify-between"><dt className="text-ink-faint">LINEアカウント</dt><dd className="font-medium">{accountName ?? '取得できていません'}</dd></div><div className="flex justify-between"><dt className="text-ink-faint">送信先</dt><dd className="font-medium">{selectedFriend?.displayName || '（名前なし）'}</dd></div><div className="flex justify-between"><dt className="text-ink-faint">区分</dt><dd className="font-medium">{recipientLabel}</dd></div></dl></div>
              <div className="border-hairline mt-4 rounded-panel border p-5"><h3 className="font-bold">テスト内容</h3><p className="text-ink-secondary mt-2 text-sm">{confirmSteps.length > 1 ? `選択した${confirmSteps.length}通を、通と通のあいだの待機を省略して順番に送信します。` : 'この1通だけを送信します。'}</p>
                <ul className="mt-4 space-y-2 text-sm">{confirmSteps.map((row) => (<li key={row.stepOrder} className="flex flex-wrap items-baseline gap-x-3"><span className="text-ink shrink-0 font-medium tabular-nums">{row.stepOrder}通目</span>{row.timing ? <span className="text-ink-secondary shrink-0">{row.timing}</span> : null}<span className="text-ink-secondary min-w-0 flex-1 truncate">{row.kind}</span></li>))}</ul>
                <p className="text-ink-faint mt-2 text-xs">タグ・情報欄の変更などのアクションは実行しません。購読の登録も増えません。</p></div>
            </section>
            <aside className="space-y-4"><div className="border-hairline rounded-panel border p-5"><h3 className="font-bold">設定サマリー</h3><p className="text-ink-faint mt-1 text-xs">テスト送信の内容を確認します。選んだ相手のLINEへ実際に届きます。</p><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><dt>送信先</dt><dd>{selectedFriend?.displayName || '（名前なし）'}</dd></div><div className="flex justify-between"><dt>送る通</dt><dd>{confirmSteps.length}通</dd></div></dl></div><div className="border-hairline rounded-panel border p-5"><h3 className="font-bold">メッセージプレビュー</h3><p className="text-ink-faint mt-1 text-xs">{friendName}さんへの表示例。名前などの差し込みは送信時に実値へ置き換わります。</p>
                {bodiesStatus === 'loading' && <p className="text-ink-faint mt-4 text-sm">本文を読み込んでいます。</p>}
                {bodiesStatus === 'error' && <p className="text-danger mt-4 text-sm">本文を読み込めませんでした。送る通と種類は左の一覧どおりです。</p>}
                {bodiesStatus === 'ready' && confirmSteps.map((row) => {
                  const body = stepBodies[row.stepOrder]
                  return (
                    <div key={row.stepOrder} className="mt-4">
                      <p className="text-ink-faint text-xs">{row.stepOrder}通目</p>
                      <div className="bg-info-bg mt-1 whitespace-pre-wrap rounded-panel p-4 text-sm">
                        {body && body.messageType === 'text'
                          ? expandTestPreviewBody(body.content, selectedFriend)
                          : `${row.kind}（登録済みの内容をそのまま送ります）`}
                      </div>
                    </div>
                  )
                })}
              </div></aside>
          </div>
        </main>
        {/*
          #985 CHK-01: 上の空き265pxは高さのあるPCの値。低い画面では
          残りの高さに合わせて縮め、下へはみ出した分はスクロールして
          「戻る」「テスト送信を開始」へ必ず到達できるようにする。
        */}
        <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto px-6 pb-6" style={{ paddingTop: 'min(265px, 30vh)', background: 'color-mix(in srgb, var(--color-ink) 35%, transparent)' }}>
          <div className="w-full rounded-panel shadow-xl" style={{ maxWidth: 672, background: 'var(--color-canvas)' }}><div className="border-hairline border-b px-6 py-5"><h2 className="text-lg font-bold">選択した1名へ実際に送信しますか？</h2><p className="text-ink-secondary mt-1 text-sm">{friendName}さん（{recipientLabel}）へ{confirmSteps.length}通をテスト送信します。実際のLINEメッセージとして届きます。</p></div><div className="space-y-3 px-6 py-5 text-sm">{requiredConfirmations.map((label, index) => (<label key={label} className="flex items-center gap-2"><input type="checkbox" checked={confirmChecks[index] === true} disabled={sending || result?.ok === true} onChange={(e) => setConfirmChecks((prev) => prev.map((v, i) => (i === index ? e.target.checked : v)))} />{label}</label>))}<p className="text-ink-faint text-xs">購読の登録は増えません。配信予定も作りません。</p>
            {sending && <p className="rounded-panel bg-info-bg text-ink-secondary px-4 py-3 text-sm">送信中です。完了までこの画面のまま待ってください。</p>}
            {result && (
              <div role="status" className={`rounded-panel px-4 py-3 text-sm ${result.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
                <p className="font-bold">{result.ok ? '送信が完了しました' : result.partial ? '一部だけ届いた可能性があります' : '送信できませんでした'}</p>
                <p className="mt-1">{result.message}</p>
                {!result.ok && (
                  <p className="mt-1 text-xs">途中で止まった場合、それまでの通は届いています。同じ送信先への連続した送信は短い間隔では実行できません。原因を解決してから、もう一度実行してください。</p>
                )}
              </div>
            )}
          </div><div className="border-hairline flex justify-end gap-2 border-t px-6 py-4">{result?.ok ? (<><Button onClick={() => setConfirming(false)}>別の相手へ送る</Button><Button variant="primary" onClick={onClose}>完了</Button></>) : (<><Button onClick={() => setConfirming(false)} disabled={sending}>戻る</Button><Button variant="primary" disabled={!selected || sending || !allConfirmed} onClick={() => void sendTest()}>{sending ? '送信中…' : result ? 'もう一度送信' : 'テスト送信を開始'}</Button></>)}</div></div>
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
      // confirming 中は上の early return で別画面へ切り替わるので、
      // ここに確認中のフッターは要らない。
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
          disabled={!selected || sending}
          onClick={openConfirm}
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control h-10 px-5 text-sm font-medium disabled:opacity-50"
        >
          内容を確認
        </button>
        </>
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

/* ------------------------------------------- 友だち別の配信予定（IDEA-05） */

/*
 * シナリオ確認（配信結果）の中で、選んだ検証顧客へ現在のシナリオが
 * どう配られるかを表示する。試算口（GET …/friends/:friendId/plan）は
 * 送信・購読登録・タグ更新を一切行わない。応答の sideEffects:false が
 * その証左なので、画面でも「送らない確認」だと断る。
 *
 * 予定の判定は配信処理と同じ関数を通る（条件分岐 evaluateCondition・
 * 絞り込み matchesCondition・日時 computeNextDeliveryAt）。配信時点の
 * 状態で結果が変わる条件は dynamic=true で返るので「未確定」と出し、
 * 確定した日時に見せない（NEXT-01〜04 の「確認が嘘をつかない」に揃える）。
 */

const FRIEND_PLAN_OUTCOME: Record<ScenarioFriendPlanStep['outcome'], string> = {
  deliver: '届く見通し',
  skip: '送らず次へ',
  branch: '条件で分岐',
  pause: 'この通のあと停止',
  undetermined: '未確定',
}

const FRIEND_PLAN_STATUS: Record<string, string> = {
  active: '配信中',
  delivering: '送信中',
  paused: '停止中',
  completed: '完了',
}

const FRIEND_PLAN_BASIS: Record<ScenarioFriendPlan['basis'], string> = {
  pinned: '購読に固定された公開版',
  published: '現在の公開版',
  draft: '下書き（公開版がないため参考）',
}

/** 予定1行。時刻が無い・動的条件で変わるものは「未確定」を添える。 */
function FriendPlanStepRow({ step }: { step: ScenarioFriendPlanStep }) {
  return (
    <li className="border-hairline border-b px-4 py-2.5 text-sm last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ink shrink-0 font-medium tabular-nums">{step.stepOrder}通目</span>
        <span className="text-ink-secondary shrink-0 tabular-nums">
          {step.scheduledAt ?? '—'}
        </span>
        <span
          className={`rounded-pill shrink-0 border px-2 py-0.5 text-xs ${
            step.outcome === 'deliver'
              ? 'border-success bg-success-bg text-success'
              : step.outcome === 'branch' || step.outcome === 'pause'
                ? 'border-warning bg-warning-bg text-warning'
                : step.outcome === 'skip'
                  ? 'border-hairline text-ink-secondary'
                  : 'border-hairline text-ink-faint'
          }`}
        >
          {FRIEND_PLAN_OUTCOME[step.outcome]}
        </span>
        {step.dynamic ? (
          <span className="text-ink-faint shrink-0 text-xs">未確定</span>
        ) : null}
      </div>
      {step.reason ? (
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{step.reason}</p>
      ) : null}
    </li>
  )
}

export function FriendPlanDialog({
  scenarioId,
  lineAccountId,
  initialFriend = null,
  onClose,
}: {
  scenarioId: string
  /** アカウント専用シナリオは、そのアカウントの友だちだけを選ぶ。 */
  lineAccountId: string | null
  /** 参加中の友だちの行から開いたとき、その人を最初から選んだ状態にする。 */
  initialFriend?: { id: string; name: string } | null
  onClose: () => void
}) {
  const { selectedAccountId } = useAccount()
  const resolvedAccountId = lineAccountId ?? selectedAccountId ?? null
  const [search, setSearch] = useState('')
  const [friends, setFriends] = useState<{ id: string; displayName: string | null }[]>([])
  const [friendsStatus, setFriendsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(initialFriend)
  const [plan, setPlan] = useState<ScenarioFriendPlan | null>(null)
  const [planStatus, setPlanStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [planError, setPlanError] = useState('')

  /* 友だちの検索。テスト送信と同じく、300ms 待ってから一覧口を叩く。 */
  useEffect(() => {
    let cancelled = false
    setFriendsStatus('loading')
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.friends.list({
            accountId: resolvedAccountId ?? undefined,
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
  }, [resolvedAccountId, search])

  /* 選んだ友だちの予定を試算口から取る。選び直すたびに取り直す。 */
  useEffect(() => {
    if (!selected || !resolvedAccountId) {
      setPlan(null)
      setPlanStatus('idle')
      return
    }
    let cancelled = false
    setPlan(null)
    setPlanError('')
    setPlanStatus('loading')
    void (async () => {
      try {
        const res = await api.scenarios.friendPlan(scenarioId, selected.id, resolvedAccountId)
        if (cancelled) return
        if (res.success) {
          setPlan(res.data)
          setPlanStatus('ready')
        } else {
          setPlanError(res.error)
          setPlanStatus('error')
        }
      } catch {
        if (!cancelled) {
          setPlanError('配信予定を読み込めませんでした。')
          setPlanStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected, resolvedAccountId, scenarioId])

  return (
    <Shell
      title="友だちへの配信予定"
      description="このシナリオが選んだ友だちへどう届くかを確認します。送信・シナリオへの登録・タグの更新は行いません。"
      onClose={onClose}
    >
      {!resolvedAccountId ? (
        <p className="rounded-panel bg-warning-bg text-ink-secondary mb-4 px-4 py-3 text-xs">
          LINE公式アカウントを選ぶと、友だちごとの配信予定を確認できます。
        </p>
      ) : null}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="名前で探す"
        className="border-hairline rounded-control text-ink h-10 w-full border px-3 text-sm"
        aria-label="確認する友だちを名前で探す"
      />
      <div className="border-hairline divide-hairline rounded-panel mt-3 max-h-48 divide-y overflow-y-auto border">
        {friendsStatus === 'ready' && friends.map((friend) => (
          <button
            key={friend.id}
            type="button"
            onClick={() => setSelected({ id: friend.id, name: friend.displayName || '（名前なし）' })}
            className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm ${
              selected?.id === friend.id ? 'bg-accent-soft text-accent font-medium' : 'text-ink'
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

      {planStatus === 'loading' && (
        <p className="text-ink-faint mt-4 px-1 text-sm">配信予定を試算しています。</p>
      )}
      {planStatus === 'error' && (
        <p className="rounded-panel bg-danger-bg text-danger mt-4 px-4 py-3 text-sm">{planError}</p>
      )}

      {planStatus === 'ready' && plan ? (
        <div className="mt-4 space-y-4">
          {/* 待機の正体。購読があれば状態と次の予定をそのまま出す。 */}
          <dl className="border-hairline rounded-panel space-y-2 border px-4 py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-faint">友だち</dt>
              <dd className="text-ink font-medium">{plan.friendName ?? selected?.name ?? '（名前なし）'}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-faint">いまの状態</dt>
              <dd className="text-ink">
                {plan.subscription
                  ? FRIEND_PLAN_STATUS[plan.subscription.status] ?? plan.subscription.status
                  : 'まだ開始していません'}
              </dd>
            </div>
            {plan.subscription?.nextDeliveryAt ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ink-faint">次の配信予定</dt>
                <dd className="text-ink tabular-nums">{plan.subscription.nextDeliveryAt}</dd>
              </div>
            ) : null}
            {plan.subscription?.pauseReason ? (
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ink-faint">止まっている理由</dt>
                <dd className="text-ink">
                  {plan.subscription.pauseReason === 'delivery_failed'
                    ? '配信失敗'
                    : plan.subscription.pauseReason === 'after_send'
                      ? 'この通を送ったあと止める設定'
                      : '画面からの停止'}
                </dd>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-faint">予定のもと</dt>
              <dd className="text-ink">{FRIEND_PLAN_BASIS[plan.basis]}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-faint">試算した時刻</dt>
              <dd className="text-ink tabular-nums">
                {new Date(plan.computedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
              </dd>
            </div>
          </dl>

          {plan.start.state === 'blocked' ? (
            <div className="rounded-panel bg-warning-bg px-4 py-3 text-sm">
              <p className="text-warning font-semibold">いまはこの友だちへ配信されません</p>
              <ul className="text-ink-secondary mt-1 list-disc space-y-1 pl-5 text-xs">
                {plan.start.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : plan.start.reasons.length > 0 ? (
            <div className="rounded-panel bg-info-bg px-4 py-3 text-xs">
              <ul className="text-ink-secondary list-disc space-y-1 pl-5">
                {plan.start.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan.steps.length > 0 ? (
            <ol className="border-hairline rounded-panel border">
              {plan.steps.map((step) => (
                <FriendPlanStepRow key={step.stepId} step={step} />
              ))}
            </ol>
          ) : plan.start.state === 'ok' ? (
            <p className="text-ink-faint px-1 text-sm">配信される通がありません。</p>
          ) : null}

          {plan.warnings.length > 0 ? (
            <div className="rounded-panel bg-info-bg px-4 py-3 text-xs">
              <ul className="text-ink-secondary list-disc space-y-1 pl-5">
                {plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Shell>
  )
}

/** 条件を1行で言い表す。札の中に出す用。 */
export function describeCondition(condition: SegmentCondition | null): string {
  if (condition === null || isEmptyCondition(condition)) return '条件なし'
  const rules = condition.rules.length
  const groups = (condition.groups ?? []).filter((g) => g.rules.length > 0).length
  if (groups === 0) return `${rules} 個の条件`
  return `${rules} 個の条件 ＋ or条件 ${groups} かたまり`
}
