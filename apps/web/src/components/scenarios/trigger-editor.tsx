'use client'

/*
 * シナリオの開始のきっかけ。
 *
 * これまで1本につき1つしか持てず、「友だち追加でも始まるし、あとでタグが
 * 付いても始まる」を作るにはシナリオを複製するしかなかった。複数持てる形に
 * したので、並べて足せるようにする。
 *
 * **0本のときが分かりにくい。** 「設定していない＝始まらない」ではなく、
 * 「外から呼ばれたときだけ始まる」が正しい。アクション・質問の選択肢・
 * 友だち追加時の配信から開始できるので、そこを書いておく。
 *
 * **編集は下書き。** 以前は足す・外すがその場で API へ保存され、
 * 「キャンセル」と「保存」が同じ onClose だった。編集中に見える面は
 * ローカルの下書きで、「開始条件を保存」を押したときだけまとめて
 * 反映する。キャンセル・Esc・背景を押すと下書きは捨てられる。
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type ScenarioTriggerItem } from '@/lib/api'
import { pruneCondition, type SegmentCondition } from '@/lib/segment-condition'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { describeCondition } from './scenario-dialogs'
import { scenarioReferenceData } from './scenario-reference-data'

interface TagOption {
  id: string
  name: string
}

/**
 * 設計（EvVO5）の「開始のきっかけ」6種。
 *
 * 実装が受け取れるのは友だち追加とタグ付与の2つだけ。残り4つは足す口が
 * 無い。**絵に描いてあるからと押せる形で並べると、押しても何も起きない
 * 面ができる。** 押せない形にして、なぜ押せないかを本文に書く。
 */
const TRIGGER_KINDS: { key: string; label: string; ready: boolean }[] = [
  { key: 'friend_add', label: '友だち追加', ready: true },
  { key: 'tag_added', label: 'タグ追加', ready: true },
  { key: 'form_answered', label: 'フォーム回答', ready: false },
  { key: 'booking_fixed', label: '予約確定', ready: false },
  { key: 'manual', label: '手動開始', ready: false },
  { key: 'api', label: 'API・Webhook', ready: false },
]

/** 一致人数の読み込み状態。 */
type MatchState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ready'
      matched: number
      alreadySubscribed: number
      newStartPlanned: number
      excluded: number
    }

/** 下書きで足した行の仮ID。保存前なのでサーバーのIDはまだ無い。 */
const draftId = (kind: string, tagId: string | null) => `draft-${kind}-${tagId ?? 'none'}`

export interface TriggerEditorProps {
  scenarioId: string
  onClose: () => void
  onChanged?: (count: number) => void
  /** シナリオ全体の絞り込み。人数を数えるのに使う。 */
  audienceCondition?: unknown
  /** いま購読中の人数。取れていなければ null。 */
  activeNow?: number | null
  /** アカウント専用シナリオは、そのアカウントの友だちだけ数える。 */
  lineAccountId?: string | null
}

export default function TriggerEditor({
  scenarioId,
  onClose,
  onChanged,
  audienceCondition,
  activeNow = null,
  lineAccountId = null,
}: TriggerEditorProps) {
  /** 最後にサーバーへ保存されている（されていると分かっている）一覧。 */
  const [saved, setSaved] = useState<ScenarioTriggerItem[] | null>(null)
  /** 編集中の下書き。ここを見せて、保存のときだけサーバーへ送る。 */
  const [draft, setDraft] = useState<ScenarioTriggerItem[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [addingTagId, setAddingTagId] = useState('')
  const [match, setMatch] = useState<MatchState>({ kind: 'none' })

  /*
   * 「押したら何人が新しく始まるのか」。
   *
   * 開始は押したあとに戻せない。押す前に人数が見えないと、条件を書き
   * 間違えたことに配信が届いてから気づくことになる。
   *
   * 数えるのは**シナリオ全体の絞り込みに一致する人**。口は
   * `POST /api/scenarios/:id/simulate`。本番と同じ対象条件・購読の重なりを
   * 数えるが、配信や購読は一切行わない。
   */
  const usableCondition = pruneCondition((audienceCondition as SegmentCondition | null) ?? null)
  const conditionKey = JSON.stringify(usableCondition)

  const recount = useCallback(async () => {
    if (!lineAccountId) {
      setMatch({ kind: 'none' })
      return
    }
    setMatch({ kind: 'loading' })
    try {
      const res = await api.scenarios.simulate(scenarioId, lineAccountId)
      setMatch(
        res.success
          ? {
              kind: 'ready',
              matched: res.data.audience.matched,
              alreadySubscribed: res.data.audience.alreadySubscribed,
              newStartPlanned: res.data.audience.newStartPlanned,
              excluded: res.data.audience.excluded,
            }
          : { kind: 'error' },
      )
    } catch {
      setMatch({ kind: 'error' })
    }
    // 条件の中身が変わったときだけ作り直す。参照の同一性では判断しない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionKey, lineAccountId, scenarioId])

  useEffect(() => {
    void recount()
  }, [recount])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.scenarios.triggers.list(scenarioId)
    if (res.success) {
      setSaved(res.data)
      setDraft(res.data)
      onChanged?.(res.data.length)
    } else {
      setError(res.error)
    }
    setLoading(false)
    // onChanged は毎描画で作り直される可能性があるので依存に入れない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void scenarioReferenceData.tags(lineAccountId).then((res) => {
      if (res.success) setTags(res.data.map((t) => ({ id: t.id, name: t.name })))
    })
  }, [lineAccountId])

  /*
   * 足す・外すは**下書きだけ**を動かす。
   *
   * 以前はここで即 `api.scenarios.triggers.add` を呼んでいたため、
   * キャンセルを押しても変更が残った（U004）。保存を押すまでサーバーは
   * 触らない。
   */
  const draftAdd = (kind: 'friend_add' | 'tag_added', tagId?: string) => {
    setError('')
    setDraft((current) => [
      ...current,
      { id: draftId(kind, tagId ?? null), kind, tagId: tagId ?? null },
    ])
    setAddingTagId('')
  }

  const draftRemove = (triggerId: string) => {
    setError('')
    setDraft((current) => current.filter((trigger) => trigger.id !== triggerId))
  }

  /** 下書きと保存済みが違うか。違っていれば「未保存」を面に出す。 */
  const dirty =
    saved !== null &&
    (draft.length !== saved.length ||
      draft.some((item) => !saved.some((s) => s.id === item.id)))

  /*
   * 下書きをまとめて反映する。
   *
   * 途中で失敗したときは一覧を読み直して実態に合わせる。半分だけ
   * 反映された状態を「保存できた」と見せない。
   */
  const save = async () => {
    if (saving || saved === null) return
    setError('')
    setSaving(true)
    const removed = saved.filter((s) => !draft.some((d) => d.id === s.id))
    const added = draft.filter((d) => !saved.some((s) => s.id === d.id))
    for (const trigger of removed) {
      const res = await api.scenarios.triggers.remove(scenarioId, trigger.id)
      if (!res.success) {
        setError(res.error)
        await load()
        setSaving(false)
        return
      }
    }
    for (const trigger of added) {
      const res = await api.scenarios.triggers.add(
        scenarioId,
        trigger.kind === 'tag_added' ? 'tag_added' : 'friend_add',
        trigger.tagId,
      )
      if (!res.success) {
        setError(res.error)
        await load()
        setSaving(false)
        return
      }
    }
    await load()
    setSaving(false)
    onClose()
  }

  const hasFriendAdd = draft.some((t) => t.kind === 'friend_add')
  const hasTagTrigger = draft.some((t) => t.kind === 'tag_added')
  const usedTagIds = new Set(draft.filter((t) => t.kind === 'tag_added').map((t) => t.tagId))
  const tagName = (id: string | null) => tags.find((t) => t.id === id)?.name ?? '（消されたタグ）'

  return (
    <Dialog
      open
      title="シナリオの開始条件"
      description="どの出来事をきっかけに、どの友だちへ開始するかを設定します。変更は「開始条件を保存」を押すまで反映されません。"
      onCancel={onClose}
      onConfirm={() => void save()}
      confirmLabel="開始条件を保存"
      cancelLabel="キャンセル"
      busy={saving}
      error={error || undefined}
    >
      {/*
        高さは画面に合わせる（U090）。以前は最小高さが固定で、低い画面では
        確定操作が下へ隠れていた。中身だけをスクロールして、キャンセルと
        保存は常に見える位置へ置く。
      */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 15rem)' }}>
        {dirty && (
          <p className="bg-warning-bg text-warning mb-4 rounded-control px-4 py-2 text-xs">
            未保存の変更があります。キャンセル・Esc・背景を押すと元に戻ります。
          </p>
        )}

        {/*
          設計（EvVO5）の開始のきっかけ6種。受け取れるのは2つだけなので、
          残りは押せない形で並べ、理由を下に書く。**絵に有るからと押せる
          形で置くと、押しても何も起きない面ができる。**
          並びは列固定ではなく幅に合わせて折り返す（U024）。
        */}
        <div className="mb-5">
          <p className="text-ink text-sm font-bold">開始のきっかけ</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {TRIGGER_KINDS.map((kind) => {
              const configured =
                kind.key === 'friend_add' ? hasFriendAdd : kind.key === 'tag_added' ? hasTagTrigger : false
              return (
                <span
                  key={kind.key}
                  aria-disabled={kind.ready ? undefined : true}
                  className={`rounded-control border px-3 py-2 text-center text-sm font-medium ${
                    kind.ready
                      ? configured
                        ? 'border-accent text-accent-deep'
                        : 'border-hairline text-ink-secondary'
                      : 'border-hairline text-ink-faint opacity-50'
                  }`}
                >
                  <span className="block">{kind.label}</span>
                  <span className="text-ink-faint mt-0.5 block text-xs font-normal">
                    {kind.ready ? (configured ? '設定済み' : '足せます') : 'まだ使えません'}
                  </span>
                </span>
              )
            })}
          </div>
          <p className="text-ink-faint mt-2 text-xs leading-relaxed">
            フォーム回答・予約確定・手動開始・API・Webhook をきっかけにする口は、まだ繋がっていません。繋がると、ここから足せるようになります。
          </p>

          {/* いま設定しているきっかけ（下書き）。 */}
          {loading ? (
            <p className="text-ink-faint py-6 text-center text-sm">読み込んでいます</p>
          ) : draft.length === 0 ? (
            <p className="text-ink-secondary mt-3 text-xs leading-relaxed">
              きっかけはありません。自動では流れませんが、止まっているわけではありません。
              アクション、質問の選択肢、「友だち追加時の配信」から呼び出せば流れます。
              呼ばれたときだけ流したいシナリオは、この状態が正しい形です。
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {draft.map((trigger) => (
                <li
                  key={trigger.id}
                  className="border-hairline rounded-card flex flex-wrap items-center justify-between gap-2 border px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="text-ink block text-sm font-bold">
                      {trigger.kind === 'friend_add'
                        ? '友だち追加時'
                        : `タグ「${tagName(trigger.tagId)}」が付いたとき`}
                    </span>
                    <span className="text-ink-faint block text-xs">
                      {trigger.kind === 'friend_add'
                        ? '新しく友だちになった人に自動で流れます'
                        : 'そのタグが付いた時点で自動で流れます'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => draftRemove(trigger.id)}
                    className="text-ink-faint hover:text-danger shrink-0 px-2 py-1 text-xs"
                  >
                    外す
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 足し口。ここで足しても保存されるのは「開始条件を保存」のとき。 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="field"
              onClick={() => draftAdd('friend_add')}
              disabled={hasFriendAdd}
              title={hasFriendAdd ? 'すでに足してあります' : undefined}
            >
              ＋ 友だち追加時
            </Button>
            <select
              value={addingTagId}
              onChange={(e) => setAddingTagId(e.target.value)}
              aria-label="きっかけにするタグ"
              className="border-hairline rounded-control bg-canvas text-ink h-10 min-w-0 flex-1 border px-3 text-sm"
            >
              <option value="">タグを選ぶ</option>
              {tags
                .filter((tag) => !usedTagIds.has(tag.id))
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
            <Button
              size="field"
              onClick={() => addingTagId && draftAdd('tag_added', addingTagId)}
              disabled={!addingTagId}
            >
              ＋ このタグが付いたとき
            </Button>
          </div>
        </div>

        {/*
          開始する友だちの条件（U005）。固定文ではなく、実際に保存されている
          対象の絞り込みから説明を作る。人数は下の試算と同じ口（simulate）。
          条件そのものの編集は詳細画面の「対象」から開くので、ここでは
          読むだけにして場所を案内する。
        */}
        <section className="border-hairline rounded-card border px-4 py-3">
          <p className="text-ink text-sm font-bold">開始する友だちの条件</p>
          <p className="text-ink-secondary mt-2 text-sm">
            {usableCondition
              ? `対象の絞り込み：${describeCondition(usableCondition)}`
              : '対象の絞り込みは未設定です。フォロー中の友だち全員が対象です。'}
            {match.kind === 'ready'
              ? ` いま一致するのは ${match.matched.toLocaleString('ja-JP')} 人です。`
              : ''}
          </p>
          <p className="text-ink-faint mt-1 text-xs">
            条件そのものは、シナリオ詳細の「開始のきっかけ」札にある「対象」から編集します。
          </p>
        </section>

        {/*
          開始回数（U006）。以前は「初回のみ開始／条件を満たすたびに開始」の
          選択カードに見えたが、入力も変更処理も無かった。実際の仕様は固定で、
          配信中・一時停止中は重ねて登録せず、読み終えた人は条件を満たすと
          もう一度始まる。選べないものを選択肢に見せないため、仕様の説明にする。
        */}
        <div className="border-hairline rounded-card mt-4 border p-4">
          <p className="text-ink text-sm font-bold">同じ友だちの開始回数</p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            同じシナリオへ同時に入れるのは1人1つまでです。配信中・一時停止中の人には重ねて開始しません。
            最後まで読み終えた人が条件を満たすと、もう一度最初から始まります。
          </p>
        </div>

        {/*
          設計（EvVO5）の「現在の条件に一致する友だち」。
          **押したあとに戻せないので、押す前に人数を見せる。**
        */}
        <div className="bg-info-bg rounded-card mt-5 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-ink text-sm font-bold">現在の条件に一致する友だち</p>
            <button
              type="button"
              onClick={() => void recount()}
              disabled={!lineAccountId || match.kind === 'loading'}
              title={lineAccountId ? undefined : 'LINE公式アカウントを選んでください'}
              className="text-accent-deep text-xs hover:underline disabled:opacity-40 disabled:no-underline"
            >
              対象を再計算
            </button>
          </div>

          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-ink-faint text-xs">一致</dt>
              <dd className="text-ink mt-0.5 text-xl font-bold tabular-nums">
                {match.kind === 'ready' ? (
                  `${match.matched.toLocaleString('ja-JP')}人`
                ) : match.kind === 'loading' ? (
                  <span className="text-ink-faint text-sm font-normal">読み込んでいます</span>
                ) : match.kind === 'error' ? (
                  <span className="text-danger text-sm font-normal">読み込めませんでした</span>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint text-xs">すでに購読中</dt>
              <dd className="text-warning mt-0.5 text-xl font-bold tabular-nums">
                {match.kind === 'ready'
                  ? `${match.alreadySubscribed.toLocaleString('ja-JP')}人`
                  : typeof activeNow === 'number'
                    ? `${activeNow.toLocaleString('ja-JP')}人`
                    : <span className="text-ink-faint">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint text-xs">新規開始予定</dt>
              <dd className="text-success mt-0.5 text-xl font-bold tabular-nums">
                {match.kind === 'ready'
                  ? `${match.newStartPlanned.toLocaleString('ja-JP')}人`
                  : <span className="text-ink-faint">—</span>}
              </dd>
            </div>
          </dl>

          {match.kind === 'error' && (
            <button
              type="button"
              onClick={() => void recount()}
              className="text-accent-deep mt-2 text-xs hover:underline"
            >
              再読み込み
            </button>
          )}

          <p className="text-ink-faint mt-3 text-xs leading-relaxed">
            {usableCondition
              ? '一致は「対象の絞り込み」に当てはまる友だちの数です。'
              : '絞り込みが空なので、フォロー中の友だち全員を数えています。'}
            {match.kind === 'ready'
              ? ` 対象外は${match.excluded.toLocaleString('ja-JP')}人です。試算では配信も購読も始まりません。`
              : ' 試算では配信も購読も始まりません。'}
          </p>
        </div>
        <p className="bg-warning-bg text-warning mt-4 rounded-control px-4 py-3 text-xs">保存後も配信は始まりません。テスト送信と開始確認を完了してから有効化します。</p>
      </div>
    </Dialog>
  )
}
