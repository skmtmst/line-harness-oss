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

interface TagOption {
  id: string
  name: string
}

export interface TriggerEditorProps {
  scenarioId: string
  onClose: () => void
  onChanged?: (count: number) => void
}

export default function TriggerEditor({ scenarioId, onClose, onChanged }: TriggerEditorProps) {
  const [triggers, setTriggers] = useState<ScenarioTriggerItem[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingTagId, setAddingTagId] = useState('')

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

          {loading ? (
            <p className="text-ink-faint py-8 text-center text-sm">読み込み中…</p>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
