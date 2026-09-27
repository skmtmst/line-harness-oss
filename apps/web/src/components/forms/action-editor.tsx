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
import Select from '@/components/shared/select'
import { cellInput, miniButton, type FormRefs } from './form-refs'

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
          <Select
            value={action.kind}
            onChange={(value) => patch(index, emptyAction(value as FormAction['kind']))}
            aria-label="動作の種類"
            options={ACTION_LABELS.map((a) => ({ value: a.kind, label: a.label }))}
          />

          {/*
            R26追補: スマホ幅では文章の入力欄を種類の選択の下に全幅で置く。
            `flex-1` だけだと同行に残って約50pxに押し込まれる。
            `basis-full` で折り返し、PC幅では元どおり横に並べる。
          */}
          {action.kind === 'send_text' && (
            <input
              type="text"
              value={action.text}
              onChange={(e) => patch(index, { ...action, text: e.target.value })}
              placeholder="送る文面"
              className={`${cellInput} min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[16rem]`}
            />
          )}

          {action.kind === 'send_template' && (
            <Select
              value={action.templateId}
              onChange={(value) => patch(index, { ...action, templateId: value })}
              aria-label="送るテンプレート"
              options={[
                { value: '', label: '— 選んでください —' },
                ...refs.templates
                  .filter((t) => t.type === 'text')
                  .map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          )}

          {action.kind === 'tag' && (
            <>
              <Select
                value={action.op}
                onChange={(value) =>
                  patch(index, { ...action, op: value as 'add' | 'remove' })
                }
                aria-label="タグの付け外し"
                options={[
                  { value: 'add', label: '付ける' },
                  { value: 'remove', label: '外す' },
                ]}
              />
              <Select
                value={action.tagIds[0] ?? ''}
                onChange={(value) =>
                  patch(index, { ...action, tagIds: value ? [value] : [] })
                }
                aria-label="タグ"
                options={[
                  { value: '', label: '— タグ —' },
                  ...refs.tags.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </>
          )}

          {action.kind === 'friend_field' && (
            <>
              <Select
                value={action.fieldId}
                onChange={(value) => patch(index, { ...action, fieldId: value })}
                aria-label="書き込む友だち情報欄"
                options={[
                  { value: '', label: '— 情報欄 —' },
                  ...refs.friendFields.map((f) => ({
                    value: f.id,
                    label: `${f.name}${f.ecIsMaster ? '（EC側が正）' : ''}`,
                    disabled: f.ecIsMaster,
                  })),
                ]}
              />
              <input
                type="text"
                value={action.value}
                onChange={(e) => patch(index, { ...action, value: e.target.value })}
                placeholder="書き込む値"
                className={`${cellInput} min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[10rem]`}
              />
            </>
          )}

          {action.kind === 'scenario' && (
            <>
              <Select
                value={action.op}
                onChange={(value) =>
                  patch(index, { ...action, op: value as 'start' | 'stop' })
                }
                aria-label="シナリオの操作"
                options={[
                  { value: 'start', label: '開始する' },
                  { value: 'stop', label: '停止する' },
                ]}
              />
              <Select
                value={action.scenarioId}
                onChange={(value) => patch(index, { ...action, scenarioId: value })}
                aria-label="シナリオ"
                options={[
                  { value: '', label: '— シナリオ —' },
                  ...refs.scenarios.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </>
          )}

          {action.kind === 'reminder' && (
            <Select
              value={action.reminderId}
              onChange={(value) => patch(index, { ...action, reminderId: value })}
              aria-label="リマインダ"
              options={[
                { value: '', label: '— リマインダ —' },
                ...refs.reminders.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
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
