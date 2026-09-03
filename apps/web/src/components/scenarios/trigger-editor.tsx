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
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type ScenarioTriggerItem } from '@/lib/api'
import { pruneCondition, type SegmentCondition } from '@/lib/segment-condition'

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
  | { kind: 'ready'; count: number }

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
  const [triggers, setTriggers] = useState<ScenarioTriggerItem[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingTagId, setAddingTagId] = useState('')
  const [match, setMatch] = useState<MatchState>({ kind: 'none' })

  /*
   * 「押したら何人が新しく始まるのか」。
   *
   * 開始は押したあとに戻せない。押す前に人数が見えないと、条件を書き
   * 間違えたことに配信が届いてから気づくことになる。
   *
   * 数えるのは**シナリオ全体の絞り込みに一致する人**。口は
   * `POST /api/segments/count`（配信の対象条件と同じもの）。
   */
  const usableCondition = pruneCondition((audienceCondition as SegmentCondition | null) ?? null)
  const conditionKey = JSON.stringify(usableCondition)

  const recount = useCallback(async () => {
    if (!usableCondition) {
      setMatch({ kind: 'none' })
      return
    }
    setMatch({ kind: 'loading' })
    try {
      const res = await api.segments.count(usableCondition, lineAccountId ?? undefined)
      setMatch(
        res.success && typeof res.count === 'number'
          ? { kind: 'ready', count: res.count }
          : { kind: 'error' },
      )
    } catch {
      setMatch({ kind: 'error' })
    }
    // 条件の中身が変わったときだけ作り直す。参照の同一性では判断しない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionKey, lineAccountId])

  useEffect(() => {
    void recount()
  }, [recount])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.scenarios.triggers.list(scenarioId)
    if (res.success) {
      setTriggers(res.data)
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
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data.map((t) => ({ id: t.id, name: t.name })))
    })
  }, [])

  const add = async (kind: 'friend_add' | 'tag_added', tagId?: string) => {
    setError('')
    const res = await api.scenarios.triggers.add(scenarioId, kind, tagId ?? null)
    if (!res.success) {
      setError(res.error)
      return
    }
    setTriggers(res.data)
    onChanged?.(res.data.length)
    setAddingTagId('')
  }

  const remove = async (triggerId: string) => {
    setError('')
    const res = await api.scenarios.triggers.remove(scenarioId, triggerId)
    if (!res.success) {
      setError(res.error)
      return
    }
    await load()
  }

  const hasFriendAdd = triggers.some((t) => t.kind === 'friend_add')
  const usedTagIds = new Set(triggers.filter((t) => t.kind === 'tag_added').map((t) => t.tagId))
  const tagName = (id: string | null) => tags.find((t) => t.id === id)?.name ?? '（消されたタグ）'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="rounded-card w-full max-w-2xl bg-white shadow-lg">
        <div className="border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-ink text-lg font-bold">開始のきっかけ</h2>
            <p className="text-ink-secondary mt-0.5 text-sm">
              このシナリオが自動で流れ始める条件です。いくつでも足せます。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-9 shrink-0 border px-4 text-sm"
          >
            閉じる
          </button>
        </div>

        <div className="px-6 py-5">
          {error && (
            <p className="rounded-card bg-danger-bg text-danger mb-4 px-4 py-3 text-sm">{error}</p>
          )}

          {/*
            設計（EvVO5）の開始のきっかけ6種。受け取れるのは2つだけなので、
            残りは押せない形で並べ、理由を下に書く。**絵に有るからと押せる
            形で置くと、押しても何も起きない面ができる。**
          */}
          <div className="mb-5">
            <p className="text-ink text-sm font-bold">開始のきっかけ</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRIGGER_KINDS.map((kind) => (
                <span
                  key={kind.key}
                  aria-disabled={kind.ready ? undefined : true}
                  className={`rounded-control border px-3 py-1.5 text-xs ${
                    kind.ready
                      ? 'border-hairline text-ink-secondary'
                      : 'border-hairline text-ink-faint opacity-50'
                  }`}
                >
                  {kind.label}
                </span>
              ))}
            </div>
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              フォーム回答・予約確定・手動開始・API・Webhook をきっかけにする口は、まだ繋がっていません。繋がると、ここから足せるようになります。
            </p>
          </div>

          {loading ? (
            <p className="text-ink-faint py-8 text-center text-sm">読み込んでいます</p>
          ) : (
            <>
              {triggers.length === 0 ? (
                <div className="border-hairline rounded-card border border-dashed px-4 py-6">
                  <p className="text-ink text-sm font-bold">きっかけはありません</p>
                  <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
                    自動では流れませんが、止まっているわけではありません。
                    アクション、質問の選択肢、「友だち追加時の配信」から呼び出せば流れます。
                    呼ばれたときだけ流したいシナリオは、この状態が正しい形です。
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {triggers.map((trigger) => (
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
                        onClick={() => void remove(trigger.id)}
                        className="text-ink-faint hover:text-danger shrink-0 text-xs"
                      >
                        外す
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-hairline mt-5 border-t pt-5">
                <p className="text-ink text-sm font-bold">きっかけを足す</p>

                <button
                  type="button"
                  onClick={() => void add('friend_add')}
                  disabled={hasFriendAdd}
                  title={hasFriendAdd ? 'すでに足してあります' : undefined}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control mt-2 h-10 border px-4 text-sm disabled:opacity-40"
                >
                  ＋ 友だち追加時
                </button>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={addingTagId}
                    onChange={(e) => setAddingTagId(e.target.value)}
                    className="border-hairline rounded-control bg-canvas text-ink h-10 min-w-0 flex-1 border px-3 text-sm"
                  >
                    <option value="">タグを選ぶ</option>
                    {tags
                      .filter((t) => !usedTagIds.has(t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addingTagId && void add('tag_added', addingTagId)}
                    disabled={!addingTagId}
                    className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-10 shrink-0 border px-4 text-sm disabled:opacity-40"
                  >
                    ＋ このタグが付いたとき
                  </button>
                </div>
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
                    disabled={!usableCondition || match.kind === 'loading'}
                    title={usableCondition ? undefined : '絞り込みが無いので数えるものがありません'}
                    className="text-accent text-xs hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    対象を再計算
                  </button>
                </div>

                <dl className="mt-3 grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-faint text-xs">一致</dt>
                    <dd className="text-ink mt-0.5 text-xl font-bold tabular-nums">
                      {match.kind === 'ready' ? (
                        `${match.count.toLocaleString('ja-JP')}人`
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
                      {typeof activeNow === 'number'
                        ? `${activeNow.toLocaleString('ja-JP')}人`
                        : <span className="text-ink-faint">—</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint text-xs">新規開始予定</dt>
                    {/* 一致から購読中を引いた数**ではない**。購読中の人が
                        いま条件に一致しているとは限らないので、引き算で出すと
                        画面にだけ在る数になる。重なりを数える口が要る。 */}
                    <dd className="text-ink-faint mt-0.5 text-xl font-bold">—</dd>
                  </div>
                </dl>

                {match.kind === 'error' && (
                  <button
                    type="button"
                    onClick={() => void recount()}
                    className="text-accent mt-2 text-xs hover:underline"
                  >
                    再読み込み
                  </button>
                )}

                <p className="text-ink-faint mt-3 text-xs leading-relaxed">
                  {usableCondition
                    ? '一致は「対象の絞り込み」に当てはまる友だちの数です。'
                    : '「対象の絞り込み」が空なので、一致は数えていません。'}
                  新規開始予定はまだ繋がっていません。一致と購読中の重なりを数える取得口が接続されると表示されます。
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
