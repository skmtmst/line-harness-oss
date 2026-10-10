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
import Button from '@/components/shared/button'
import { SaveErrorField } from '@/components/shared/save-form-errors'

const ACTION_LABELS: { kind: FormAction['kind']; label: string }[] = [
  { kind: 'send_text', label: 'テキストを送る' },
  { kind: 'send_template', label: 'テンプレートを送る' },
  { kind: 'tag', label: 'タグを付ける・外す' },
  { kind: 'friend_field', label: '友だち情報に書く' },
  { kind: 'scenario', label: 'シナリオを開始・停止' },
  { kind: 'reminder', label: 'リマインダを開始' },
]

function emptyAction(kind: Exclude<FormAction['kind'], 'research_action'>): FormAction {
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
          <SaveErrorField names={[`value.${index}.kind`,"kind","action.kind"]}><Select
            value={action.kind}
            disabled={action.kind === 'research_action'}
            onChange={(value) => patch(index, emptyAction(value as Exclude<FormAction['kind'], 'research_action'>))}
            aria-label="動作の種類"
            options={[...ACTION_LABELS.map((a) => ({ value: a.kind, label: a.label })), ...(action.kind === 'research_action' ? [{ value: 'research_action', label: 'リサーチで設定した動作' }] : [])]}
          /></SaveErrorField>

          {action.kind === 'research_action' && <p>変更はリサーチの編集から行ってください。</p>}

          {/*
            R26追補: スマホ幅では文章の入力欄を種類の選択の下に全幅で置く。
            `flex-1` だけだと同行に残って約50pxに押し込まれる。
            `basis-full` で折り返し、PC幅では元どおり横に並べる。
          */}
          {action.kind === 'send_text' && (
            <SaveErrorField names={[`value.${index}.text`,"text","action.text"]}>
            <input
              type="text"
              value={action.text}
              onChange={(e) => patch(index, { ...action, text: e.target.value })}
              placeholder="送る文面"
              className={`${cellInput} min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[16rem]`}
            /></SaveErrorField>
          )}

          {action.kind === 'send_template' && (
            <SaveErrorField names={[`value.${index}.templateId`,`value.${index}.template_id`,"templateId","action.templateId","template_id","action.template_id"]}>
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
            /></SaveErrorField>
          )}

          {action.kind === 'tag' && (
            <>
              <SaveErrorField names={[`value.${index}.op`,"op","action.op"]}>
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
              /></SaveErrorField>
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
              <SaveErrorField names={[`value.${index}.fieldId`,`value.${index}.field_id`,"fieldId","action.fieldId","field_id","action.field_id"]}><Select
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
              </SaveErrorField>
              <SaveErrorField names={[`value.${index}.value`,"value","action.value"]}><input
                type="text"
                value={action.value}
                onChange={(e) => patch(index, { ...action, value: e.target.value })}
                placeholder="書き込む値"
                className={`${cellInput} min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[10rem]`}
              />
            </SaveErrorField>
            </>
          )}

          {action.kind === 'scenario' && (
            <>
              <SaveErrorField names={[`value.${index}.op`,"op","action.op"]}>
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
              /></SaveErrorField>
              <SaveErrorField names={[`value.${index}.scenarioId`,`value.${index}.scenario_id`,"scenarioId","action.scenarioId","scenario_id","action.scenario_id"]}>
              <Select
                value={action.scenarioId}
                onChange={(value) => patch(index, { ...action, scenarioId: value })}
                aria-label="シナリオ"
                options={[
                  { value: '', label: '— シナリオ —' },
                  ...refs.scenarios.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </SaveErrorField>
            </>
          )}

          {action.kind === 'reminder' && (
            <SaveErrorField names={[`value.${index}.reminderId`,`value.${index}.reminder_id`,"reminderId","action.reminderId","reminder_id","action.reminder_id"]}>
            <Select
              value={action.reminderId}
              onChange={(value) => patch(index, { ...action, reminderId: value })}
              aria-label="リマインダ"
              options={[
                { value: '', label: '— リマインダ —' },
                ...refs.reminders.map((r) => ({ value: r.id, label: r.name })),
              ]}
            /></SaveErrorField>
          )}

          <button
            onClick={() => remove(index)}
            className="text-danger ml-auto px-1 text-xs hover:underline"
            aria-label="この動作を削除"
          >
            削除する
          </button>
        </div>
      ))}

      <Button variant="secondary" className={(`${miniButton} border-hairline rounded-control border border-dashed px-3 py-1.5`) + ' h-auto whitespace-normal'} onClick={() => onChange([...value, emptyAction('tag')])}>
        ＋ 動作を追加する
      </Button>
    </div>
  )
}
