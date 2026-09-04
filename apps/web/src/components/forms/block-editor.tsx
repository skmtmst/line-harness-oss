'use client'

/**
 * ブロック1つぶんの設定。
 *
 * 種類ごとに出す項目が違う。共通で出せるもの（タイトル・必須・非表示）は
 * 上に固定し、その種類にしかないもの（入力制限・選択肢・リマインダ）を
 * 下に足していく。並びを固定しているのは、ブロックを見比べるときに
 * 目が同じ位置を追えるようにするため。
 *
 * 「回答の登録先」は複数選べる。同じ回答を本名と情報欄の両方に入れたい、
 * という運用が実際にあるため。
 */

import type {
  FormBlock,
  FormInputBlock,
  FormInputFormat,
  FormInputType,
  FormSection,
} from '@line-crm/shared'
import ChoiceTable from './choice-table'
import { cellInput, fieldInput, fieldSelect, type FormRefs } from './form-refs'

export const BLOCK_MENU: { kind: string; type?: FormInputType; label: string; group: string }[] = [
  { kind: 'image', label: '画像', group: '飾り' },
  { kind: 'heading', label: '見出し', group: '飾り' },
  { kind: 'text', label: 'テキスト', group: '飾り' },
  { kind: 'button', label: 'ボタン', group: '飾り' },
  { kind: 'input', type: 'text', label: '単一行 入力', group: '入力' },
  { kind: 'input', type: 'textarea', label: '複数行 入力', group: '入力' },
  { kind: 'input', type: 'radio', label: 'ラジオ ボタン', group: '入力' },
  { kind: 'input', type: 'checkbox', label: 'チェック ボックス', group: '入力' },
  { kind: 'input', type: 'select', label: 'プルダウン', group: '入力' },
  { kind: 'input', type: 'file', label: 'ファイル', group: '入力' },
  { kind: 'input', type: 'date', label: '日付', group: '入力' },
  { kind: 'input', type: 'prefecture', label: '都道府県', group: '入力' },
]

const INPUT_TYPE_LABEL: Record<FormInputType, string> = {
  text: '単一行',
  textarea: '複数行',
  radio: 'ラジオボタン',
  checkbox: 'チェックボックス',
  select: 'プルダウン',
  file: 'ファイル',
  date: '日付',
  prefecture: '都道府県',
}

const FORMATS: { value: FormInputFormat; label: string }[] = [
  { value: 'none', label: '指定なし' },
  { value: 'kana', label: 'カナ' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'tel', label: '電話番号' },
  { value: 'integer', label: '整数' },
  { value: 'time', label: '時刻' },
  { value: 'zip', label: '郵便番号' },
]

/** ブロックの肩に出す名前。 */
export function blockTypeLabel(block: FormBlock): string {
  if (block.kind !== 'input') {
    return { image: '画像', heading: '見出し', text: 'テキスト', button: 'ボタン' }[block.kind]
  }
  return INPUT_TYPE_LABEL[block.type]
}

export default function BlockEditor({
  block,
  index,
  sections,
  refs,
  selected,
  onSelect,
  onChange,
}: {
  block: FormBlock
  index: number
  sections: FormSection[]
  refs: FormRefs
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<FormBlock>) => void
}) {
  const patchInput = (patch: Partial<FormInputBlock>) => onChange(patch as Partial<FormBlock>)

  /**
   * 入力欄の種類を変える。
   *
   * 選択肢を持つ種類へ変えるときは、空のまま置かない（選択肢ゼロの
   * ラジオボタンは、回答画面で「答えようがない欄」になる）。逆に
   * 選択肢を持たない種類へ変えても、選択肢は消さずに残す。戻したときに
   * 打ち直しになるため。
   */
  const changeInputType = (type: FormInputType) => {
    if (block.kind !== 'input') return
    const nextIsChoice = type === 'radio' || type === 'checkbox' || type === 'select'
    if (nextIsChoice && (block.choices ?? []).length === 0) {
      patchInput({
        type,
        choiceMode: block.choiceMode ?? 'tag',
        choices: [
          { id: `c_${Math.random().toString(36).slice(2, 8)}`, label: '選択肢1' },
          { id: `c_${Math.random().toString(36).slice(2, 8)}`, label: '選択肢2' },
        ],
      })
      return
    }
    patchInput({ type })
  }

  return (
    <section
      onFocus={onSelect}
      onClick={onSelect}
      data-block-kind={block.kind}
      className={`rounded-card border p-4 transition-colors ${
        selected ? 'border-accent bg-canvas' : 'border-hairline bg-canvas'
      }`}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="shrink-0 text-center">
          <span className="bg-accent-deep text-on-accent rounded-control inline-block px-2 py-0.5 text-xs font-bold tabular-nums">
            {index + 1}
          </span>
          <span className="text-ink-faint mt-1 block text-[11px] leading-tight whitespace-nowrap">
            {blockTypeLabel(block)}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {/* ---- 飾りのブロック ---- */}
          {block.kind === 'heading' && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[16rem] flex-1">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">見出し</span>
                <input
                  type="text"
                  value={block.text}
                  onChange={(e) => onChange({ text: e.target.value } as Partial<FormBlock>)}
                  className={fieldInput}
                />
              </label>
              <label>
                <span className="text-ink-secondary mb-1 block text-xs font-medium">大きさ</span>
                <select
                  value={block.level ?? 2}
                  onChange={(e) =>
                    onChange({ level: Number(e.target.value) as 1 | 2 | 3 } as Partial<FormBlock>)
                  }
                  className={fieldSelect}
                >
                  <option value={1}>見出し1</option>
                  <option value={2}>見出し2</option>
                  <option value={3}>見出し3</option>
                </select>
              </label>
            </div>
          )}

          {block.kind === 'text' && (
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">本文</span>
              <textarea
                rows={3}
                value={block.text}
                onChange={(e) => onChange({ text: e.target.value } as Partial<FormBlock>)}
                className={`${fieldInput} resize-y`}
              />
            </label>
          )}

          {block.kind === 'image' && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[18rem] flex-1">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">
                  画像のURL
                </span>
                <input
                  type="url"
                  value={block.mediaUrl}
                  onChange={(e) => onChange({ mediaUrl: e.target.value } as Partial<FormBlock>)}
                  placeholder="https://..."
                  className={fieldInput}
                />
              </label>
              <label>
                <span className="text-ink-secondary mb-1 block text-xs font-medium">幅</span>
                <select
                  value={block.size ?? 'normal'}
                  onChange={(e) =>
                    onChange({ size: e.target.value as 'normal' | 'full' } as Partial<FormBlock>)
                  }
                  className={fieldSelect}
                >
                  <option value="normal">通常</option>
                  <option value="full">画面いっぱい</option>
                </select>
              </label>
              <label className="min-w-[14rem] flex-1">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">
                  押したときに開くURL（任意）
                </span>
                <input
                  type="url"
                  value={block.linkUrl ?? ''}
                  onChange={(e) => onChange({ linkUrl: e.target.value } as Partial<FormBlock>)}
                  className={fieldInput}
                />
              </label>
            </div>
          )}

          {block.kind === 'button' && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[12rem] flex-1">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">
                  ボタンの文字
                </span>
                <input
                  type="text"
                  value={block.label}
                  onChange={(e) => onChange({ label: e.target.value } as Partial<FormBlock>)}
                  className={fieldInput}
                />
              </label>
              <label className="min-w-[16rem] flex-1">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">開くURL</span>
                <input
                  type="url"
                  value={block.url}
                  onChange={(e) => onChange({ url: e.target.value } as Partial<FormBlock>)}
                  placeholder="https://..."
                  className={fieldInput}
                />
              </label>
              <label>
                <span className="text-ink-secondary mb-1 block text-xs font-medium">見た目</span>
                <select
                  value={block.style ?? 'default'}
                  onChange={(e) =>
                    onChange({
                      style: e.target.value as 'default' | 'outline',
                    } as Partial<FormBlock>)
                  }
                  className={fieldSelect}
                >
                  <option value="default">塗り</option>
                  <option value="outline">枠のみ</option>
                </select>
              </label>
            </div>
          )}

          {/* ---- 入力のブロック ---- */}
          {block.kind === 'input' && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">タイプ</span>
                  <select
                    value={block.type}
                    onChange={(e) => changeInputType(e.target.value as FormInputType)}
                    className={fieldSelect}
                  >
                    {(Object.keys(INPUT_TYPE_LABEL) as FormInputType[]).map((t) => (
                      <option key={t} value={t}>
                        {INPUT_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-[16rem] flex-1">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">
                    タイトル
                  </span>
                  <input
                    type="text"
                    value={block.label}
                    onChange={(e) => patchInput({ label: e.target.value })}
                    placeholder="質問の見出し"
                    className={fieldInput}
                  />
                </label>

                {block.type === 'date' && (
                  <label>
                    <span className="text-ink-secondary mb-1 block text-xs font-medium">
                      入力の形
                    </span>
                    <select
                      value={block.dateStyle ?? 'calendar'}
                      onChange={(e) =>
                        patchInput({ dateStyle: e.target.value as 'calendar' | 'ymd' })
                      }
                      className={fieldSelect}
                    >
                      <option value="calendar">カレンダー</option>
                      <option value="ymd">年月日を入力</option>
                    </select>
                  </label>
                )}

                {block.type === 'file' && (
                  <label>
                    <span className="text-ink-secondary mb-1 block text-xs font-medium">
                      受け取るもの
                    </span>
                    <select value="image" disabled className={`${fieldSelect} opacity-60`}>
                      <option value="image">画像</option>
                    </select>
                  </label>
                )}
              </div>

              {/* 回答の登録先 */}
              <div>
                <span className="text-ink-secondary mb-1 block text-xs font-medium">
                  回答の登録先（複数可）
                </span>
                <p className="text-ink-faint mb-1.5 text-xs">
                  友だち情報欄で定義した項目から選びます。決めると、友だち詳細に出て
                  テンプレートで差し込めます。
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      const current = block.destinations?.friendFieldIds ?? []
                      if (current.includes(e.target.value)) return
                      patchInput({
                        destinations: {
                          ...block.destinations,
                          friendFieldIds: [...current, e.target.value],
                        },
                      })
                    }}
                    className={fieldSelect}
                    aria-label="友だち情報欄を足す"
                  >
                    <option value="">＋ 友だち情報欄</option>
                    {refs.friendFields.map((f) => (
                      <option key={f.id} value={f.id} disabled={f.ecIsMaster}>
                        {f.name}
                        {f.ecIsMaster ? '（EC側が正）' : ''}
                      </option>
                    ))}
                  </select>

                  {(['realName', 'displayName', 'note'] as const)
                    .filter(
                      (key) =>
                        // 複数行を本名・システム表示名に入れる運用は無い
                        block.type !== 'textarea' || key === 'note',
                    )
                    .map((key) => (
                      <label
                        key={key}
                        className="text-ink-secondary flex items-center gap-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={block.destinations?.[key] ?? false}
                          onChange={(e) =>
                            patchInput({
                              destinations: { ...block.destinations, [key]: e.target.checked },
                            })
                          }
                        />
                        {{ realName: '本名', displayName: 'システム表示名', note: '個別メモ' }[key]}
                      </label>
                    ))}
                </div>

                {(block.destinations?.friendFieldIds ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(block.destinations?.friendFieldIds ?? []).map((id) => {
                      const field = refs.friendFields.find((f) => f.id === id)
                      return (
                        <span
                          key={id}
                          className="bg-accent-soft text-accent rounded-pill inline-flex items-center gap-1 px-2 py-0.5 text-xs"
                        >
                          {field?.name ?? '（消えた項目）'}
                          <button
                            onClick={() =>
                              patchInput({
                                destinations: {
                                  ...block.destinations,
                                  friendFieldIds: (
                                    block.destinations?.friendFieldIds ?? []
                                  ).filter((x) => x !== id),
                                },
                              })
                            }
                            aria-label={`${field?.name ?? ''}を外す`}
                            className="hover:text-ink"
                          >
                            ×
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 選択肢 */}
              {(block.type === 'radio' ||
                block.type === 'checkbox' ||
                block.type === 'select') && (
                <ChoiceTable
                  block={block}
                  sections={sections}
                  refs={refs}
                  onChange={patchInput}
                />
              )}

              {/* 説明文・初期値・プレースホルダ */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">
                    説明文
                  </span>
                  <input
                    type="text"
                    value={block.description ?? ''}
                    onChange={(e) => patchInput({ description: e.target.value })}
                    placeholder="例：西暦でご入力ください"
                    className={fieldInput}
                  />
                </label>

                {(block.type === 'text' || block.type === 'textarea') && (
                  <label className="block">
                    <span className="text-ink-secondary mb-1 block text-xs font-medium">
                      うすい文字（プレースホルダ）
                    </span>
                    <input
                      type="text"
                      value={block.placeholder ?? ''}
                      onChange={(e) => patchInput({ placeholder: e.target.value })}
                      className={fieldInput}
                    />
                  </label>
                )}

                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">初期値</span>
                  <input
                    type="text"
                    value={block.defaultValue ?? ''}
                    onChange={(e) => patchInput({ defaultValue: e.target.value })}
                    placeholder="はじめから入れておく値"
                    className={fieldInput}
                  />
                </label>
              </div>

              {/* 入力制限 */}
              {(block.type === 'text' || block.type === 'textarea') && (
                <div className="border-hairline rounded-control bg-canvas-sunken border p-3">
                  <span className="text-ink-secondary mb-2 block text-xs font-medium">
                    入力制限
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    {block.type === 'text' && (
                      <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                        形式
                        <select
                          value={block.limit?.format ?? 'none'}
                          onChange={(e) =>
                            patchInput({
                              limit: { ...block.limit, format: e.target.value as FormInputFormat },
                            })
                          }
                          className={fieldSelect}
                        >
                          {FORMATS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                      <input
                        type="number"
                        min={0}
                        value={block.limit?.min ?? ''}
                        onChange={(e) =>
                          patchInput({
                            limit: {
                              ...block.limit,
                              min: e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          })
                        }
                        className={`${cellInput} w-20`}
                        placeholder="下限"
                      />
                      〜
                      <input
                        type="number"
                        min={0}
                        value={block.limit?.max ?? ''}
                        onChange={(e) =>
                          patchInput({
                            limit: {
                              ...block.limit,
                              max: e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          })
                        }
                        className={`${cellInput} w-20`}
                        placeholder="上限"
                      />
                      文字
                    </label>
                    <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={block.limit?.hideCounter ?? false}
                        onChange={(e) =>
                          patchInput({ limit: { ...block.limit, hideCounter: e.target.checked } })
                        }
                      />
                      文字数を出さない
                    </label>
                  </div>
                </div>
              )}

              {/* 日付からリマインダ */}
              {block.type === 'date' && (
                <div className="border-hairline rounded-control bg-canvas-sunken border p-3">
                  <label className="text-ink-secondary flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={!!block.reminder}
                      onChange={(e) =>
                        patchInput({
                          reminder: e.target.checked
                            ? { reminderId: '', time: '09:00' }
                            : null,
                        })
                      }
                    />
                    この日付からリマインダを起動する
                  </label>

                  {block.reminder && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={block.reminder.reminderId}
                        onChange={(e) =>
                          patchInput({
                            reminder: { ...block.reminder!, reminderId: e.target.value },
                          })
                        }
                        className={fieldSelect}
                      >
                        <option value="">— リマインダ —</option>
                        {refs.reminders.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <span className="text-ink-faint text-xs">
                        友だちが入力した日付を起点にします
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 共通のチェック */}
              <div className="border-hairline flex flex-wrap gap-4 border-t pt-3">
                <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={block.required ?? false}
                    onChange={(e) => patchInput({ required: e.target.checked })}
                  />
                  必須
                </label>
                {(block.type === 'radio' || block.type === 'checkbox') && (
                  <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={block.inline ?? false}
                      onChange={(e) => patchInput({ inline: e.target.checked })}
                    />
                    横並び
                  </label>
                )}
                <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={block.hidden ?? false}
                    onChange={(e) => patchInput({ hidden: e.target.checked })}
                  />
                  非表示
                </label>
                <span className="text-ink-faint ml-auto text-xs">
                  回答データの見出し：{block.name}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
