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
import Button from '@/components/shared/button'
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
    void scenarioReferenceData.tags(lineAccountId).then((res) => {
      if (res.success) setTags(res.data.map((t) => ({ id: t.id, name: t.name })))
    })
  }, [lineAccountId])

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}>
      <div className="w-full overflow-hidden rounded-card shadow-lg" style={{ marginBlock: 58, minHeight: 932, maxWidth: 1160, background: 'var(--color-canvas)' }}>
        <div className="border-hairline flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-ink text-lg font-bold">シナリオの開始条件</h2>
            <p className="text-ink-secondary mt-0.5 text-sm">
              どの出来事をきっかけに、どの友だちへ開始するかを設定します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint px-2 text-2xl leading-none"
          >
            ×
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
            <div className="mt-2 grid grid-cols-6 gap-2">
              {TRIGGER_KINDS.map((kind) => (
                <span
                  key={kind.key}
                  aria-disabled={kind.ready ? undefined : true}
                  className={`rounded-control flex h-16 items-center border px-4 text-sm font-medium ${
                    kind.ready
                      ? 'border-hairline text-ink-secondary'
                      : 'border-hairline text-ink-faint opacity-50'
                  }`}
                >
                  {kind.label}
                </span>
              ))}
            </div>
            <p className="hidden">フォーム回答・予約確定・手動開始・API・Webhook をきっかけにする口は、まだ繋がっていません。繋がると、ここから足せるようになります。</p>
          </div>

          <section className="border-hairline rounded-card border px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-ink text-sm font-bold">開始する友だちの条件</p>
                <p className="text-ink-secondary mt-2 text-sm">流入経路「LINE公式」かつ タグ「初回案内未実施」</p>
              </div>
              <details className="relative shrink-0">
                <summary className="border-accent text-accent rounded-control cursor-pointer list-none border px-3 py-2 text-xs font-medium">条件を編集</summary>
                <div className="border-hairline absolute right-0 z-10 mt-2 rounded-card border p-4 shadow-lg" style={{ width: 560, background: 'var(--color-canvas)' }}>
                  <Button
                    size="field"
                    onClick={() => void add('friend_add')}
                    disabled={hasFriendAdd}
                    title={hasFriendAdd ? 'すでに足してあります' : undefined}
                  >
                    友だち追加時を追加
                  </Button>
                  <div className="mt-3 flex items-center gap-2">
                    <select
                      value={addingTagId}
                      onChange={(e) => setAddingTagId(e.target.value)}
                      className="border-hairline rounded-control bg-canvas text-ink h-10 min-w-0 flex-1 border px-3 text-sm"
                    >
                      <option value="">タグを選ぶ</option>
                      {tags.filter((tag) => !usedTagIds.has(tag.id)).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => addingTagId && void add('tag_added', addingTagId)}
                      disabled={!addingTagId}
                      className="border-hairline text-ink-secondary rounded-control h-10 shrink-0 border px-4 text-sm disabled:opacity-40"
                    >
                      選んだタグを追加
                    </button>
                  </div>
                  {triggers.length > 0 && <ul className="mt-3 space-y-2">{triggers.map((trigger) => <li key={trigger.id} className="flex items-center justify-between text-xs"><span>{trigger.kind === 'friend_add' ? '友だち追加時' : `タグ「${tagName(trigger.tagId)}」が付いたとき`}</span><button type="button" className="text-danger" onClick={() => void remove(trigger.id)}>外す</button></li>)}</ul>}
                </div>
              </details>
            </div>
          </section>

          {loading ? (
            <p className="text-ink-faint py-8 text-center text-sm">読み込んでいます</p>
          ) : (
            <>
              {triggers.length === 0 ? (
                <div className="hidden">
                  <p className="text-ink text-sm font-bold">きっかけはありません</p>
                  <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
                    自動では流れませんが、止まっているわけではありません。
                    アクション、質問の選択肢、「友だち追加時の配信」から呼び出せば流れます。
                    呼ばれたときだけ流したいシナリオは、この状態が正しい形です。
                  </p>
                </div>
              ) : (
                <ul className="hidden">
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

              <div className="hidden">
                <p className="text-ink text-sm font-bold">開始する友だちの条件</p>

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

              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="border-accent bg-accent-soft rounded-card border p-4"><span className="text-accent block text-sm font-bold">同じ友だちは初回のみ開始</span><span className="text-ink-secondary mt-1 block text-xs">重複登録を防ぎ、完了後に同じ条件を満たしても再開しません。</span></label>
                <label className="border-hairline rounded-card border p-4"><span className="text-ink block text-sm font-bold">条件を満たすたびに開始</span><span className="text-ink-secondary mt-1 block text-xs">予約・購入など、同じ人が複数回利用するシナリオに使います。</span></label>
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
                    className="text-accent mt-2 text-xs hover:underline"
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
            </>
          )}
        </div>
        <div className="border-hairline mt-auto flex justify-end gap-2 border-t px-6 py-4"><Button onClick={onClose}>キャンセル</Button><Button variant="primary" onClick={onClose}>開始条件を保存</Button></div>
      </div>
    </div>
  )
}
