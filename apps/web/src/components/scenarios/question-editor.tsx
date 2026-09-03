'use client'

/*
 * 質問メッセージ（分岐）の編集。
 *
 * 選択肢ごとに「押されたら何が起きるか」を全部この場に置く。別画面に
 * 分けると、2つの選択肢の差（片方だけタグを付ける等）が見比べられない。
 *
 * 文字数の上限は LINE 側の都合。超えたぶんは途中で切れて相手に届くので、
 * 保存を止めるのではなく**その場で残り文字数を出す**。
 */

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

export type ChoiceBehavior = 'none' | 'url' | 'tel' | 'add_friend' | 'mail' | 'form' | 'scenario'

export interface QuestionChoice {
  label: string
  behavior: ChoiceBehavior
  url?: string
  tel?: string
  email?: string
  scenario?: { op: 'start' | 'stop'; scenarioId?: string | null; restart?: 'from_start' | 'from_read'; rememberPrevious?: boolean }
  userMessage?: string
  hideUserMessage?: boolean
  reply?: string
  repeatReply?: string
  addTagIds?: string[]
  removeTagIds?: string[]
  field?: { fieldId: string; value: string }
}

export interface ScenarioQuestion {
  intro?: string
  text: string
  altText?: string
  tapMode: 'single' | 'multiple'
  choices: QuestionChoice[]
}

const BEHAVIORS: { value: ChoiceBehavior; label: string }[] = [
  { value: 'none', label: '何もしない' },
  { value: 'url', label: 'URLを開く' },
  { value: 'tel', label: '電話をかける' },
  { value: 'add_friend', label: 'LINEアカウントを友だち追加' },
  { value: 'mail', label: 'メールを送る' },
  { value: 'form', label: '回答フォームを開く' },
  { value: 'scenario', label: 'シナリオを移動・停止' },
]

export function emptyQuestion(): ScenarioQuestion {
  return {
    text: '',
    tapMode: 'single',
    choices: [
      { label: 'はい', behavior: 'none' },
      { label: 'いいえ', behavior: 'none' },
    ],
  }
}

/*
 * 入力欄の見た目は、他の画面（友だち属性・シナリオ編集）と同じにそろえる。
 * この画面だけ枠や余白が違うと、同じアプリに見えない。
 */
const inputClass =
  'border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
const selectClass =
  'border-hairline rounded-control bg-canvas text-ink focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
const areaClass =
  'border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full resize-y border px-3 py-2 text-sm focus:ring-2 focus:outline-none'

/** 上限に対する残りを出す。超えた時点で赤くする。 */
function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max
  return (
    <span className={`text-xs tabular-nums ${over ? 'text-danger font-bold' : 'text-ink-faint'}`}>
      {value.length}/{max}
    </span>
  )
}

export interface QuestionEditorProps {
  value: ScenarioQuestion
  onChange: (next: ScenarioQuestion) => void
  /** 選択肢ごとのアクション設定を開く。保存済みの通でだけ使える。 */
  onOpenChoiceActions?: (choiceIndex: number) => void
  /** 質問テンプレートのように、選択肢を横に見比べる画面。 */
  choiceColumns?: boolean
}

export default function QuestionEditor({
  value,
  onChange,
  onOpenChoiceActions,
  choiceColumns = false,
}: QuestionEditorProps) {
  const { selectedAccountId } = useAccount()
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [fields, setFields] = useState<{ id: string; name: string }[]>([])
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([])
  const [openChoice, setOpenChoice] = useState<number | null>(0)

  useEffect(() => {
    if (!selectedAccountId) {
      setFields([])
      return
    }
    void (async () => {
      const [tagRes, fieldRes, scenarioRes] = await Promise.all([
        api.tags.list(),
        api.friendFields.list(selectedAccountId),
        api.scenarios.list(),
      ])
      if (tagRes.success) setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      if (fieldRes.success) setFields(fieldRes.data.map((f) => ({ id: f.id, name: f.name })))
      if (scenarioRes.success) setScenarios(scenarioRes.data.map((s) => ({ id: s.id, name: s.name })))
    })()
  }, [selectedAccountId])

  const setChoice = (index: number, patch: Partial<QuestionChoice>) => {
    const choices = [...value.choices]
    choices[index] = { ...choices[index], ...patch }
    onChange({ ...value, choices })
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-ink-secondary text-xs font-medium">前文</span>
          <CharCount value={value.intro ?? ''} max={4500} />
        </div>
        <p className="text-ink-faint mt-0.5 mb-1.5 text-xs leading-relaxed">
          質問の前に、ふつうのテキストメッセージとして流れます。空なら送りません。差し込み（
          <code className="text-ink-faint">{'{{name}}'}</code> など）が使えます。
        </p>
        <textarea
          rows={3}
          value={value.intro ?? ''}
          onChange={(e) => onChange({ ...value, intro: e.target.value })}
          className={areaClass}
        />
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-ink-secondary text-xs font-medium">
            質問文 <span className="text-danger">*</span>
          </span>
          <CharCount value={value.text} max={160} />
        </div>
        <input
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder="例：体調はいかがですか？"
          className={`${inputClass} mt-1.5`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-ink-secondary text-xs font-medium">質問の回答は</span>
        <select
          value={value.tapMode}
          onChange={(e) => onChange({ ...value, tapMode: e.target.value as 'single' | 'multiple' })}
          className={selectClass}
        >
          <option value="single">1つのみタップ可能</option>
          <option value="multiple">すべてタップ可能</option>
        </select>
      </div>

      <div className={choiceColumns ? 'grid gap-3 xl:grid-cols-2' : 'space-y-3'}>
        {value.choices.map((choice, index) => (
          <div key={index} className="border-hairline rounded-card border">
            <div className="border-hairline bg-canvas-sunken flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <button
                type="button"
                onClick={() => setOpenChoice(openChoice === index ? null : index)}
                className="text-ink min-w-0 text-left text-sm font-bold"
              >
                選択肢{index + 1}
                <span className="text-ink-secondary ml-2 font-normal">
                  {choice.label || '（未入力）'}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                {onOpenChoiceActions && (
                  <button
                    type="button"
                    onClick={() => onOpenChoiceActions(index)}
                    className="border-hairline text-ink-secondary rounded-control h-9 border px-3 text-xs"
                  >
                    アクション
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onChange({ ...value, choices: value.choices.filter((_, i) => i !== index) })
                  }
                  disabled={value.choices.length <= 1}
                  className="text-ink-faint hover:text-danger text-xs disabled:opacity-40"
                >
                  削除
                </button>
              </div>
            </div>

            {openChoice === index && (
              <div className="space-y-4 px-4 py-4">
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink-secondary text-xs font-medium">
                      ボタンの文字 <span className="text-danger">*</span>
                    </span>
                    <CharCount value={choice.label} max={20} />
                  </div>
                  <input
                    value={choice.label}
                    onChange={(e) => setChoice(index, { label: e.target.value })}
                    className={`${inputClass} mt-1.5`}
                  />
                  <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                    10文字を超えると、機種によっては途中で切れて表示されます。
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-secondary text-xs font-medium">選択後の挙動</span>
                  <select
                    value={choice.behavior}
                    onChange={(e) => setChoice(index, { behavior: e.target.value as ChoiceBehavior })}
                    className={selectClass}
                  >
                    {BEHAVIORS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>

                {(choice.behavior === 'url' || choice.behavior === 'add_friend' || choice.behavior === 'form') && (
                  <input
                    value={choice.url ?? ''}
                    onChange={(e) => setChoice(index, { url: e.target.value })}
                    placeholder="https://…"
                    className={inputClass}
                  />
                )}
                {choice.behavior === 'tel' && (
                  <input
                    value={choice.tel ?? ''}
                    onChange={(e) => setChoice(index, { tel: e.target.value })}
                    placeholder="0312345678"
                    className={inputClass}
                  />
                )}
                {choice.behavior === 'mail' && (
                  <input
                    value={choice.email ?? ''}
                    onChange={(e) => setChoice(index, { email: e.target.value })}
                    placeholder="info@example.com"
                    className={inputClass}
                  />
                )}
                {choice.behavior === 'scenario' && (
                  <div className="bg-canvas-sunken rounded-card space-y-2 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={choice.scenario?.op ?? 'start'}
                        onChange={(e) =>
                          setChoice(index, {
                            scenario: { ...choice.scenario, op: e.target.value as 'start' | 'stop' },
                          })
                        }
                        className={selectClass}
                      >
                        <option value="start">購読を始める</option>
                        <option value="stop">購読を止める</option>
                      </select>
                      <select
                        value={choice.scenario?.scenarioId ?? ''}
                        onChange={(e) =>
                          setChoice(index, {
                            scenario: {
                              op: choice.scenario?.op ?? 'start',
                              ...choice.scenario,
                              scenarioId: e.target.value,
                            },
                          })
                        }
                        className={selectClass}
                      >
                        <option value="">
                          {choice.scenario?.op === 'stop' ? 'このシナリオ' : 'シナリオを選ぶ'}
                        </option>
                        {scenarios.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {(choice.scenario?.op ?? 'start') === 'start' && (
                      <>
                        {(
                          [
                            { value: 'from_start', label: '最初から' },
                            { value: 'from_read', label: '(再開)友だちが読んだところから' },
                          ] as const
                        ).map((opt) => (
                          <label key={opt.value} className="text-ink-secondary flex items-center gap-1.5 text-xs">
                            <input
                              type="radio"
                              checked={(choice.scenario?.restart ?? 'from_start') === opt.value}
                              onChange={() =>
                                setChoice(index, {
                                  scenario: {
                                    op: choice.scenario?.op ?? 'start',
                                    ...choice.scenario,
                                    restart: opt.value,
                                  },
                                })
                              }
                            />
                            {opt.label}
                          </label>
                        ))}
                        <label className="text-ink-secondary flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={choice.scenario?.rememberPrevious === true}
                            onChange={(e) =>
                              setChoice(index, {
                                scenario: {
                                  op: choice.scenario?.op ?? 'start',
                                  ...choice.scenario,
                                  rememberPrevious: e.target.checked,
                                },
                              })
                            }
                          />
                          いまのシナリオを控えて、あとで戻せるようにする
                        </label>
                      </>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink-secondary text-xs font-medium">ユーザーメッセージ</span>
                    <CharCount value={choice.userMessage ?? ''} max={60} />
                  </div>
                  <input
                    value={choice.userMessage ?? ''}
                    onChange={(e) => setChoice(index, { userMessage: e.target.value })}
                    placeholder={choice.label || '空欄なら選択肢の文字が使われます'}
                    disabled={choice.hideUserMessage === true}
                    className={`${inputClass} mt-1.5 disabled:opacity-50`}
                  />
                  <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                    ボタンを押したときに、友だちの発言としてトークに残る文です。
                  </p>
                  <label className="text-ink-secondary mt-1.5 flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={choice.hideUserMessage === true}
                      onChange={(e) => setChoice(index, { hideUserMessage: e.target.checked })}
                    />
                    ユーザーメッセージを使用しない
                  </label>
                </div>

                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink-secondary text-xs font-medium">選択時の返信</span>
                    <CharCount value={choice.reply ?? ''} max={4500} />
                  </div>
                  <textarea
                    rows={2}
                    value={choice.reply ?? ''}
                    onChange={(e) => setChoice(index, { reply: e.target.value })}
                    placeholder="「〇〇」ですね。わかりました！"
                    className={`${areaClass} mt-1.5`}
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink-secondary text-xs font-medium">二度押し時の返信</span>
                    <CharCount value={choice.repeatReply ?? ''} max={4500} />
                  </div>
                  <textarea
                    rows={2}
                    value={choice.repeatReply ?? ''}
                    onChange={(e) => setChoice(index, { repeatReply: e.target.value })}
                    placeholder="すでに押されています！"
                    className={`${areaClass} mt-1.5`}
                  />
                  <p className="text-ink-faint mt-1 text-xs leading-relaxed">
                    空欄なら「すでに押されています！」を返します。2度目はタグもシナリオも動かしません。
                  </p>
                </div>

                <TagPicker
                  label="選択時に追加するタグ"
                  tags={tags}
                  selected={choice.addTagIds ?? []}
                  onChange={(ids) => setChoice(index, { addTagIds: ids })}
                />
                <TagPicker
                  label="選択時にはずすタグ"
                  tags={tags}
                  selected={choice.removeTagIds ?? []}
                  onChange={(ids) => setChoice(index, { removeTagIds: ids })}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-secondary text-xs font-medium">友だち情報欄</span>
                  <select
                    value={choice.field?.fieldId ?? ''}
                    onChange={(e) =>
                      setChoice(index, {
                        field: e.target.value
                          ? { fieldId: e.target.value, value: choice.field?.value ?? '' }
                          : undefined,
                      })
                    }
                    className={selectClass}
                  >
                    <option value="">設定しない</option>
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  {choice.field?.fieldId && (
                    <input
                      value={choice.field.value}
                      onChange={(e) =>
                        setChoice(index, {
                          field: { fieldId: choice.field!.fieldId, value: e.target.value },
                        })
                      }
                      placeholder="セットする値（既存の値は上書き）"
                      className="border-hairline rounded-control text-ink h-9 min-w-0 flex-1 border px-3 text-sm"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              choices: [...value.choices, { label: '', behavior: 'none' }],
            })
          }
          disabled={value.choices.length >= 13}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-card h-10 w-full border border-dashed text-sm disabled:opacity-40"
        >
          ＋ 選択肢を追加
        </button>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-ink-secondary text-xs font-medium">PC版・通知欄での代替テキスト</span>
          <CharCount value={value.altText ?? ''} max={400} />
        </div>
        <input
          value={value.altText ?? ''}
          onChange={(e) => onChange({ ...value, altText: e.target.value })}
          placeholder="空欄なら質問文が使われます"
          className={`${inputClass} mt-1.5`}
        />
      </div>
    </div>
  )
}

function TagPicker({
  label,
  tags,
  selected,
  onChange,
}: {
  label: string
  tags: { id: string; name: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div>
      <span className="text-ink-secondary text-xs font-medium">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const on = selected.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() =>
                onChange(on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])
              }
              className={`rounded-pill h-8 px-3 text-xs transition-colors ${
                on ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary border'
              }`}
            >
              {tag.name}
            </button>
          )
        })}
        {tags.length === 0 && <span className="text-ink-faint text-xs">タグがまだありません</span>}
      </div>
    </div>
  )
}
