'use client'

import { useEffect, useState } from 'react'
import type { ReminderTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'

const TRIGGERS: Array<{ key: ReminderTriggerType; label: string }> = [
  { key: 'manual', label: '手動で対象を登録' },
  { key: 'booking', label: '予約が入ったとき' },
  { key: 'event', label: 'イベントに申し込まれたとき' },
]

/** 「どれだけ前に送るか」の選択肢。分で持つ。 */
const OFFSETS = [
  { minutes: 60, label: '1時間前' },
  { minutes: 180, label: '3時間前' },
  { minutes: 1440, label: '1日前' },
  { minutes: 2880, label: '2日前' },
  { minutes: 10080, label: '1週間前' },
]

export default function NewReminderPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState<ReminderTriggerType>('booking')
  const [sendAtTime, setSendAtTime] = useState('19:00')
  const [offsetMinutes, setOffsetMinutes] = useState(1440)
  const [targetTagId, setTargetTagId] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [activateNow, setActivateNow] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
  }, [])

  return (
    <CreatePage
      title="リマインダを作る"
      description="予約やイベントの前に、忘れないようLINEで自動でお知らせします。"
      parent={['リマインダ', '/reminders']}
      saveLabel="リマインダを作成"
      validate={() => {
        if (!name.trim()) return 'リマインダ名を入力してください'
        if (!messageContent.trim()) return '送る内容を入力してください'
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
        setMessageContent('')
      }}
      onSave={async () => {
        const res = await api.reminders.create({
          name: name.trim(),
          description: description.trim() || null,
          triggerType,
          sendAtTime: triggerType === 'manual' ? null : sendAtTime || null,
          targetTagId: targetTagId || null,
        })
        if (!res.success) throw new Error(res.error)
        // ステップが1つも無いと、対象に加わっても何も届かない。作るときに
        // 1通目まで入れてしまう。
        await api.reminders.addStep(res.data.id, {
          offsetMinutes,
          messageType: 'text',
          messageContent: messageContent.trim(),
        })
        return res.data.id
      }}
      aside={
        <>
          <AsideCard title="届き方のプレビュー" note="テスト用の予約情報">
            <div className="bg-canvas-sunken rounded-card p-3">
              <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
              <p className="text-ink-faint mb-1 text-xs">
                {OFFSETS.find((o) => o.minutes === offsetMinutes)?.label ?? ''}
                {triggerType !== 'manual' && sendAtTime ? ` ${sendAtTime}` : ''}
              </p>
              <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                {messageContent || '（送る内容がまだありません）'}
              </p>
            </div>
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              {'{{name}}'} や {'{{予約日時}}'} は、送るときに一人ひとりの内容へ置き換わります。
            </p>
          </AsideCard>

          <AsideCard title="送られないケース" note="以下にあてはまるときは自動で見送ります。">
            <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
              <li>・友だちがブロックしている</li>
              <li>・予約がキャンセル済みになっている</li>
              <li>・設定した時刻を過ぎてから予約が入った</li>
            </ul>
          </AsideCard>
        </>
      }
    >
      <FormSection step={1} label="どのリマインダか" note="一覧に表示される名前です。お客様には見えません。">
        <Field label="リマインダ名" htmlFor="rm-name" required>
          <input
            id="rm-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：予約前日のお知らせ"
            className={inputClass}
          />
        </Field>

        {/* リマインダにフォルダを持たせる列が無い。 */}
        <Field label="フォルダ" note="フォルダ分けは準備中です。">
          <select disabled className={`${inputClass} opacity-50`}>
            <option>未分類</option>
          </select>
        </Field>

        <Field label="説明" htmlFor="rm-desc" note="管理用のメモです。">
          <textarea
            id="rm-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} resize-y`}
          />
        </Field>
      </FormSection>

      <FormSection
        step={2}
        label="いつ送るか"
        note="基準にする出来事と、そこからどれだけ前に送るかを決めます。"
      >
        <Field label="基準にする出来事">
          <div className="grid gap-2 sm:grid-cols-3">
            <ChoiceCard
              selected={triggerType === 'booking'}
              title="予約の日時"
              note="予約管理で確定した予約が対象です"
              onClick={() => setTriggerType('booking')}
            />
            <ChoiceCard
              selected={triggerType === 'event'}
              title="イベントの開催日"
              note="イベント予約の申込者が対象です"
              onClick={() => setTriggerType('event')}
            />
            <ChoiceCard
              selected={triggerType === 'manual'}
              title="指定した日時"
              note="一度だけ送ります"
              onClick={() => setTriggerType('manual')}
            />
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="どれだけ前に送るか" htmlFor="rm-offset">
            <select
              id="rm-offset"
              value={offsetMinutes}
              onChange={(e) => setOffsetMinutes(Number(e.target.value))}
              className={inputClass}
            >
              {OFFSETS.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {triggerType !== 'manual' && (
            <Field
              label="送る時刻"
              htmlFor="rm-time"
              note="この時刻を過ぎている分は送られません。空にすると、予約の時刻を起点にずらして届きます。"
            >
              <input
                id="rm-time"
                type="time"
                value={sendAtTime}
                onChange={(e) => setSendAtTime(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </div>
      </FormSection>

      <FormSection step={3} label="誰に送るか" note="対象を絞り込みたいときに指定します。">
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            selected={!targetTagId}
            title="対象になった友だち全員"
            note="予約・申込をした本人に送ります"
            onClick={() => setTargetTagId('')}
          />
          <ChoiceCard
            selected={Boolean(targetTagId)}
            title="タグでさらに絞り込む"
            note="指定したタグを持つ人だけに送ります"
            onClick={() => setTargetTagId(targetTagId || (tags[0]?.id ?? ''))}
          />
        </div>
        {targetTagId && (
          <Field label="対象のタグ" htmlFor="rm-tag">
            <select
              id="rm-tag"
              value={targetTagId}
              onChange={(e) => setTargetTagId(e.target.value)}
              className={inputClass}
            >
              {tags.length === 0 && <option value="">（タグがありません）</option>}
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </FormSection>

      <FormSection
        step={4}
        label="送る内容"
        note="テンプレートから呼び出すか、直接入力します。"
      >
        {/* テンプレートを本文に流し込む口が無い（4-3-1 と同じ）。 */}
        <button
          type="button"
          disabled
          title="テンプレートからの読み込みは準備中です"
          className="border-hairline text-ink-faint rounded-control border px-3 py-1.5 text-xs opacity-50"
        >
          テンプレートから選ぶ
        </button>

        <Field
          label="本文"
          htmlFor="rm-body"
          required
          note={`${'{{name}}'} や ${'{{予約日時}}'} は、送るときに一人ひとりの内容へ置き換わります。`}
        >
          <textarea
            id="rm-body"
            rows={5}
            value={messageContent}
            onChange={(e) => setMessageContent(e.target.value)}
            placeholder="例：{{name}}さん、明日のご予約のお知らせです。"
            className={`${inputClass} resize-y`}
          />
        </Field>

        {/* 作ったリマインダを止めておく口が無い。作成時は常に動きだす。 */}
        <label className="text-ink-faint flex items-start gap-2 text-sm" title="準備中です">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={activateNow}
            disabled
            onChange={(e) => setActivateNow(e.target.checked)}
          />
          <span>
            作成したらすぐ動かす
            <span className="block text-xs">
              オフにすると下書きとして保存され、条件に合っても送られません。下書きは準備中です。
            </span>
          </span>
        </label>
      </FormSection>
    </CreatePage>
  )
}
