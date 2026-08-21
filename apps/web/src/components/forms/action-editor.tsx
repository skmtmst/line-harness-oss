'use client'

/**
 * 動作の編集。
 *
 * 「選択肢を選んだとき」と「回答を送ったあと」の2か所から同じものを使う。
 * どちらも中身は同じ（何を送る・何を付ける・どこへ登録する）で、置き場所
 * だけが違う。片方にしかない動作を作ると、運用側が「あっちでできたのに」
 * と探すことになるので、1つの部品にしてある。
 */

import type { FormAction } from '@line-crm/shared'
import { cellInput, fieldSelect, miniButton, type FormRefs } from './form-refs'

const ACTION_LABELS: { kind: FormAction['kind']; label: string }[] = [
  { kind: 'send_text', label: 'テキストを送る' },
  { kind: 'send_template', label: 'テンプレートを送る' },
  { kind: 'tag', label: 'タグを付ける・外す' },
  { kind: 'friend_field', label: '友だち情報に書く' },
  { kind: 'scenario', label: 'シナリオを開始・停止' },
  { kind: 'reminder', label: 'リマインダを開始' },
]

function emptyAction(kind: FormAction['kind']): FormAction {
  switch (kind) {
    case 'send_text':
      return { kind: 'send_text', text: '' }
    case 'send_template':
      return { kind: 'send_template', templateId: '' }
    case 'tag':
      return { kind: 'tag', op: 'add', tagIds: [] }
    case 'friend_field':
      return { kind: 'friend_field', fieldId: '', value: '' }
    case 'scenario':
      return { kind: 'scenario', op: 'start', scenarioId: '' }
    case 'reminder':
      return { kind: 'reminder', reminderId: '' }
  }
}

export default function ActionEditor({
  value,
  onChange,
  refs,
}: {
  value: FormAction[]
  onChange: (next: FormAction[]) => void
  refs: FormRefs
}) {
  const patch = (index: number, next: FormAction) =>
    onChange(value.map((a, i) => (i === index ? next : a)))

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index))

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-ink-faint text-xs">まだ何も起きません。下から選んで足せます。</p>
      )}

      {value.map((action, index) => (
        <div
          key={index}
          className="border-hairline rounded-control bg-canvas-sunken flex flex-wrap items-center gap-2 border p-2"
        >
          <select
            value={action.kind}
            onChange={(e) => patch(index, emptyAction(e.target.value as FormAction['kind']))}
            className={fieldSelect}
            aria-label="動作の種類"
          >
            {ACTION_LABELS.map((a) => (
              <option key={a.kind} value={a.kind}>
                {a.label}
              </option>
            ))}
          </select>

          {action.kind === 'send_text' && (
            <input
              type="text"
              value={action.text}
              onChange={(e) => patch(index, { ...action, text: e.target.value })}
              placeholder="送る文面"
              className={`${cellInput} min-w-[16rem] flex-1`}
            />
          )}

          {action.kind === 'send_template' && (
            <select
              value={action.templateId}
              onChange={(e) => patch(index, { ...action, templateId: e.target.value })}
              className={fieldSelect}
            >
              <option value="">— 選んでください —</option>
              {refs.templates
                .filter((t) => t.type === 'text')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          )}

          {action.kind === 'tag' && (
            <>
              <select
                value={action.op}
                onChange={(e) =>
                  patch(index, { ...action, op: e.target.value as 'add' | 'remove' })
                }
                className={fieldSelect}
              >
                <option value="add">付ける</option>
                <option value="remove">外す</option>
              </select>
              <select
                value={action.tagIds[0] ?? ''}
                onChange={(e) =>
                  patch(index, { ...action, tagIds: e.target.value ? [e.target.value] : [] })
                }
                className={fieldSelect}
              >
                <option value="">— タグ —</option>
                {refs.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {action.kind === 'friend_field' && (
            <>
              <select
                value={action.fieldId}
                onChange={(e) => patch(index, { ...action, fieldId: e.target.value })}
                className={fieldSelect}
              >
                <option value="">— 情報欄 —</option>
                {refs.friendFields.map((f) => (
                  <option key={f.id} value={f.id} disabled={f.ecIsMaster}>
                    {f.name}
                    {f.ecIsMaster ? '（EC側が正）' : ''}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={action.value}
                onChange={(e) => patch(index, { ...action, value: e.target.value })}
                placeholder="書き込む値"
                className={`${cellInput} min-w-[10rem] flex-1`}
              />
            </>
          )}

          {action.kind === 'scenario' && (
            <>
              <select
                value={action.op}
                onChange={(e) =>
                  patch(index, { ...action, op: e.target.value as 'start' | 'stop' })
                }
                className={fieldSelect}
              >
                <option value="start">開始する</option>
                <option value="stop">停止する</option>
              </select>
              <select
                value={action.scenarioId}
                onChange={(e) => patch(index, { ...action, scenarioId: e.target.value })}
                className={fieldSelect}
              >
                <option value="">— シナリオ —</option>
                {refs.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {action.kind === 'reminder' && (
            <select
              value={action.reminderId}
              onChange={(e) => patch(index, { ...action, reminderId: e.target.value })}
              className={fieldSelect}
            >
              <option value="">— リマインダ —</option>
              {refs.reminders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => remove(index)}
            className="text-danger ml-auto px-1 text-xs hover:underline"
            aria-label="この動作を削除"
          >
            削除
          </button>
        </div>
      ))}

      <button
        onClick={() => onChange([...value, emptyAction('tag')])}
        className={`${miniButton} border-hairline rounded-control border border-dashed px-3 py-1.5`}
      >
        ＋ 動作を追加
      </button>
    </div>
  )
}
