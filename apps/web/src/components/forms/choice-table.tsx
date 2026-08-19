'use client'

/**
 * 選択肢の表。
 *
 * 「選んだら何が起きるか」を、選択肢ごとに横1行で見せる。別画面に分けると
 * 2つの選択肢の差（片方だけタグを付ける等）が見比べられない。
 *
 * 「選択時の動作」を切り替えると、真ん中の列の意味が変わる。
 *   タグ追加       … 選択肢ごとに付けるタグ
 *   友だち情報に登録 … 欄はブロックで1つ決め、選択肢ごとに書き込む値
 *   動作           … 選択肢ごとに、送る・付ける・開始するを組む
 */

import { useState } from 'react'
import { newBlockId, type FormChoice, type FormInputBlock, type FormSection } from '@line-crm/shared'
import ActionEditor from './action-editor'
import { cellInput, fieldSelect, miniButton, type FormRefs } from './form-refs'

const MODES: { value: NonNullable<FormInputBlock['choiceMode']>; label: string }[] = [
  { value: 'tag', label: 'タグ追加' },
  { value: 'friendField', label: '友だち情報に登録' },
  { value: 'action', label: '動作' },
]

export default function ChoiceTable({
  block,
  sections,
  refs,
  onChange,
}: {
  block: FormInputBlock
  /** 分岐（移動先セクション）で選ぶ候補 */
  sections: FormSection[]
  refs: FormRefs
  onChange: (next: Partial<FormInputBlock>) => void
}) {
  const [openChoiceId, setOpenChoiceId] = useState<string | null>(null)
  const mode = block.choiceMode ?? 'tag'
  const choices = block.choices ?? []

  const setChoices = (next: FormChoice[]) => onChange({ choices: next })

  const patchChoice = (id: string, patch: Partial<FormChoice>) =>
    setChoices(choices.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const addChoice = (base?: FormChoice) =>
    setChoices([
      ...choices,
      base
        ? { ...base, id: newBlockId('c'), label: `${base.label}のコピー` }
        : { id: newBlockId('c'), label: `選択肢${choices.length + 1}` },
    ])

  const addOther = () =>
    setChoices([
      ...choices,
      { id: newBlockId('c'), label: 'その他', isOther: true },
    ])

  const removeChoice = (id: string) => setChoices(choices.filter((c) => c.id !== id))

  const move = (id: string, delta: number) => {
    const from = choices.findIndex((c) => c.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= choices.length) return
    const next = [...choices]
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    setChoices(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-secondary text-xs font-medium">選択時の動作</span>
        <div className="border-hairline rounded-control inline-flex overflow-hidden border">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => onChange({ choiceMode: m.value })}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m.value
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'friendField' && (
          <select
            value={block.choiceFriendFieldId ?? ''}
            onChange={(e) => onChange({ choiceFriendFieldId: e.target.value || null })}
            className={fieldSelect}
            aria-label="登録する友だち情報欄"
          >
            <option value="">— 情報欄を選ぶ —</option>
            {refs.friendFields.map((f) => (
              <option key={f.id} value={f.id} disabled={f.ecIsMaster}>
                {f.name}
                {f.ecIsMaster ? '（EC側が正）' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="border-hairline rounded-control overflow-hidden border">
        <div className="bg-canvas-sunken text-ink-faint grid grid-cols-[1fr_1fr_auto] items-center gap-2 px-3 py-2 text-xs font-medium">
          <span>選択肢</span>
          <span>
            {mode === 'tag' ? 'タグ' : mode === 'friendField' ? '登録する値' : '動作'}
          </span>
          <span className="whitespace-nowrap">並び・設定</span>
        </div>

        <ul className="divide-hairline divide-y">
          {choices.map((choice) => (
            <li key={choice.id} className="px-3 py-2">
              <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <input
                  type="text"
                  value={choice.label}
                  onChange={(e) => patchChoice(choice.id, { label: e.target.value })}
                  placeholder="項目名"
                  className={cellInput}
                />

                {mode === 'tag' && (
                  <select
                    value={choice.tagId ?? ''}
                    onChange={(e) => patchChoice(choice.id, { tagId: e.target.value || null })}
                    className={cellInput}
                    aria-label="付けるタグ"
                  >
                    <option value="">— 付けない —</option>
                    {refs.tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}

                {mode === 'friendField' && (
                  <input
                    type="text"
                    value={choice.value ?? ''}
                    onChange={(e) => patchChoice(choice.id, { value: e.target.value })}
                    placeholder="空欄なら項目名がそのまま入ります"
                    className={cellInput}
                  />
                )}

                {mode === 'action' && (
                  <button
                    onClick={() =>
                      setOpenChoiceId(openChoiceId === choice.id ? null : choice.id)
                    }
                    className={`${miniButton} border-hairline rounded-control border px-2 py-1.5 text-left`}
                  >
                    {choice.actions?.length
                      ? `${choice.actions.length}件の動作`
                      : '動作を決める'}
                  </button>
                )}

                <div className="flex items-center gap-1 whitespace-nowrap">
                  <button
                    onClick={() => move(choice.id, -1)}
                    className="text-ink-faint hover:text-ink px-1 text-xs"
                    aria-label="上へ"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(choice.id, 1)}
                    className="text-ink-faint hover:text-ink px-1 text-xs"
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setOpenChoiceId(openChoiceId === choice.id ? null : choice.id)}
                    className="text-ink-secondary hover:text-ink px-1 text-xs"
                  >
                    設定
                  </button>
                  <button
                    onClick={() => addChoice(choice)}
                    className="text-ink-secondary hover:text-ink px-1 text-xs"
                  >
                    複製
                  </button>
                  <button
                    onClick={() => removeChoice(choice.id)}
                    className="text-danger px-1 text-xs"
                    aria-label="削除"
                  >
                    ×
                  </button>
                </div>
              </div>

              {openChoiceId === choice.id && (
                <div className="border-hairline bg-canvas-sunken rounded-control mt-2 space-y-3 border p-3">
                  {mode === 'action' && (
                    <div>
                      <p className="text-ink-secondary mb-1 text-xs font-medium">
                        「{choice.label}」を選んだときの動作
                      </p>
                      <ActionEditor
                        value={choice.actions ?? []}
                        onChange={(actions) => patchChoice(choice.id, { actions })}
                        refs={refs}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-4">
                    <label className="text-ink-secondary flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={choice.defaultSelected ?? false}
                        onChange={(e) =>
                          patchChoice(choice.id, { defaultSelected: e.target.checked })
                        }
                      />
                      はじめから選んでおく
                    </label>

                    <label className="text-ink-secondary flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={choice.capacity?.enabled ?? false}
                        onChange={(e) =>
                          patchChoice(choice.id, {
                            capacity: {
                              enabled: e.target.checked,
                              limit: choice.capacity?.limit ?? 10,
                            },
                          })
                        }
                      />
                      定員を決める
                    </label>

                    {choice.capacity?.enabled && (
                      <label className="text-ink-secondary flex items-center gap-1 text-xs">
                        <input
                          type="number"
                          min={1}
                          value={choice.capacity.limit ?? 10}
                          onChange={(e) =>
                            patchChoice(choice.id, {
                              capacity: {
                                enabled: true,
                                limit: Math.max(1, Number(e.target.value) || 1),
                              },
                            })
                          }
                          className={`${cellInput} w-20`}
                        />
                        人まで
                      </label>
                    )}
                  </div>

                  <label className="block">
                    <span className="text-ink-secondary mb-1 block text-xs font-medium">
                      選んだ人を飛ばすページ
                    </span>
                    <select
                      value={choice.jumpToSectionId ?? ''}
                      onChange={(e) =>
                        patchChoice(choice.id, { jumpToSectionId: e.target.value || null })
                      }
                      className={cellInput}
                    >
                      <option value="">— 次のページへ進む —</option>
                      {sections.map((s, i) => (
                        <option key={s.id} value={s.id}>
                          {i + 1}. {s.name}
                        </option>
                      ))}
                    </select>
                    <span className="text-ink-faint mt-1 block text-xs">
                      決めると、この選択肢を選んだ人だけ別のページへ進みます。
                    </span>
                  </label>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="border-hairline flex flex-wrap gap-2 border-t p-2">
          <button onClick={() => addChoice()} className={miniButton}>
            ＋ 選択肢を追加
          </button>
          <button
            onClick={() => addChoice(choices[choices.length - 1])}
            disabled={choices.length === 0}
            className={`${miniButton} disabled:opacity-40`}
          >
            ＋ 最後の選択肢を複製
          </button>
          <button
            onClick={addOther}
            disabled={choices.some((c) => c.isOther)}
            className={`${miniButton} disabled:opacity-40`}
          >
            ＋「その他」を追加
          </button>
        </div>
      </div>

      {block.type === 'checkbox' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-ink-secondary text-xs font-medium">選べる数</span>
          <label className="text-ink-secondary flex items-center gap-1 text-xs">
            <input
              type="number"
              min={0}
              value={block.selectionLimit?.min ?? ''}
              onChange={(e) =>
                onChange({
                  selectionLimit: {
                    ...block.selectionLimit,
                    min: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
              className={`${cellInput} w-20`}
              placeholder="下限"
            />
            つ以上
          </label>
          <label className="text-ink-secondary flex items-center gap-1 text-xs">
            <input
              type="number"
              min={0}
              value={block.selectionLimit?.max ?? ''}
              onChange={(e) =>
                onChange({
                  selectionLimit: {
                    ...block.selectionLimit,
                    max: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
              className={`${cellInput} w-20`}
              placeholder="上限"
            />
            つまで
          </label>
        </div>
      )}
    </div>
  )
}
