'use client'

import { useEffect, useState } from 'react'
import type { Folder, ReminderTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import CreatePage, {
  AsideCard,
  ChoiceCard,
  Field,
  FormSection,
  inputClass,
} from '@/components/shared/create-page'
import { TextArea } from '@/components/shared/form-controls'
import SelectField from '@/components/shared/select-field'
import { useAccount } from '@/contexts/account-context'

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
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [folderId, setFolderId] = useState('')
  const [triggerType, setTriggerType] = useState<ReminderTriggerType>('booking')
  const [sendAtTime, setSendAtTime] = useState('19:00')
  const [offsetMinutes, setOffsetMinutes] = useState(1440)
  const [targetTagId, setTargetTagId] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [activateNow, setActivateNow] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [foldersLoadState, setFoldersLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [foldersReloadToken, setFoldersReloadToken] = useState(0)
  // 154: 友だち情報欄の日付を起点にするときの設定
  const [triggerFieldId, setTriggerFieldId] = useState('')
  const [repeatYearly, setRepeatYearly] = useState(true)
  const [dateFields, setDateFields] = useState<Array<{ id: string; name: string }>>([])
  const [templateId, setTemplateId] = useState('')
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([])
  // 153: 配信方式。作成後は変えられない
  const [deliveryMode, setDeliveryMode] = useState<'time' | 'countdown'>('countdown')
  const [offsetDays, setOffsetDays] = useState(-1)
  const [stepSendAtTime, setStepSendAtTime] = useState('10:00')

  useEffect(() => {
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
    void api.templates.list().then((res) => {
      if (res.success) setTemplates(res.data.map((t) => ({ id: t.id, name: t.name })))
    })
    // 起点にできるのは日付の欄だけ。文字の欄を選ばせても日付として読めない。
    if (!selectedAccountId) return
    void api.friendFields.list(selectedAccountId).then((res) => {
      if (res.success) {
        setDateFields(
          res.data
            .filter((f) => f.type === 'date')
            .map((f) => ({ id: f.id, name: f.name })),
        )
      }
    })
  }, [selectedAccountId])

  useEffect(() => {
    let active = true
    setFolders([])
    setFolderId('')
    setFoldersLoadState('loading')
    void api.folders.list('reminder')
      .then((res) => {
        if (!active) return
        if (res.success) {
          setFolders(res.data)
          setFoldersLoadState('ready')
        } else {
          setFoldersLoadState('error')
        }
      })
      .catch(() => {
        if (active) setFoldersLoadState('error')
      })
    return () => {
      active = false
    }
  }, [foldersReloadToken])

  return (
    <CreatePage
      title="リマインダを作る"
      description="予約やイベントの前に、忘れないようLINEで自動でお知らせします。"
      parent={['リマインダ', '/reminders']}
      saveLabel="リマインダを作成"
      validate={() => {
        if (accountLoading) return 'LINEアカウントを確認しています'
        if (!selectedAccountId) return 'LINEアカウントを選んでください'
        if (!name.trim()) return 'リマインダ名を入力してください'
        // テンプレートを選んでいれば本文は要らない。どちらも空なら何も届かない。
        if (!templateId && !messageContent.trim()) {
          return '送る内容を入力するか、テンプレートを選んでください'
        }
        if (triggerType === 'friend_field' && !triggerFieldId) {
          return '起点にする友だち情報の欄を選んでください'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
        setFolderId('')
        setMessageContent('')
      }}
      onSave={async () => {
        const res = await api.reminders.create({
          name: name.trim(),
          description: description.trim() || null,
          lineAccountId: selectedAccountId!,
          folderId: folderId || null,
          triggerType,
          sendAtTime: triggerType === 'manual' ? null : sendAtTime || null,
          targetTagId: targetTagId || null,
          deliveryMode,
          triggerFieldId: triggerType === 'friend_field' ? triggerFieldId || null : null,
          repeatYearly: triggerType === 'friend_field' ? repeatYearly : false,
        })
        if (!res.success) throw new Error(res.error)
        // 下書きとして作りたい場合は、作ったあとに止める。作成の受け口が
        // is_active を受け取らないので、ここで1回だけ更新する。
        if (!activateNow) {
          await api.reminders.update(res.data.id, { isActive: false })
        }
        // 通が1つも無いと、対象に加わっても何も届かない。作るときに1通目まで入れる。
        await api.reminders.addStep(res.data.id, {
          offsetMinutes,
          messageType: 'text',
          // テンプレートを選んでいても本文は残す。テンプレートを消したときに
          // ここが送られる（参照が切れて何も届かなくなるのを防ぐ）。
          messageContent: messageContent.trim() || '（テンプレートから送ります）',
          templateId: templateId || null,
          // 「○日前の●時」で決めるときは、日数と時刻を持たせる。
          offsetDays: deliveryMode === 'time' ? offsetDays : null,
          sendAtTime: deliveryMode === 'time' ? stepSendAtTime : null,
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

        <Field
          label="フォルダ"
          note={foldersLoadState === 'error'
            ? 'フォルダを読み込めませんでした。未取得と0件を区別するため、選択を止めています。'
            : foldersLoadState === 'ready' && folders.length === 0
              ? 'フォルダはまだありません。一覧から追加できます。'
              : '一覧で作ったリマインダ用フォルダから選べます。'}
        >
          <div className="flex items-center gap-2">
            <SelectField
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              disabled={foldersLoadState !== 'ready'}
              aria-label="リマインダのフォルダ"
              className={inputClass}
              options={[
                {
                  value: '',
                  label: foldersLoadState === 'loading'
                  ? 'フォルダを読み込み中'
                  : foldersLoadState === 'error'
                    ? 'フォルダを読み込めませんでした'
                    : '未分類',
                },
                ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
              ]}
            />
            {foldersLoadState === 'error' && (
              <Button onClick={() => setFoldersReloadToken((value) => value + 1)}>
                フォルダを再読み込み
              </Button>
            )}
          </div>
        </Field>

        <Field label="説明" htmlFor="rm-desc" note="管理用のメモです。">
          <TextArea
            id="rm-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
            <ChoiceCard
              selected={triggerType === 'friend_field'}
              title="友だち情報欄の日付"
              note="誕生日・次回お届け日・契約更新日など"
              onClick={() => setTriggerType('friend_field')}
            />
          </div>
        </Field>

        {triggerType === 'friend_field' && (
          <>
            <Field
              label="どの日付を見るか"
              htmlFor="rm-field"
              note="友だち情報の「日付」の欄だけが並びます。"
            >
              <SelectField
                id="rm-field"
                value={triggerFieldId}
                onChange={(e) => setTriggerFieldId(e.target.value)}
                aria-label="リマインダの起点にする日付"
                className={inputClass}
                options={[
                  { value: '', label: dateFields.length === 0 ? '（日付の欄がありません）' : '選んでください' },
                  ...dateFields.map((field) => ({ value: field.id, label: field.name })),
                ]}
              />
            </Field>

            <Field label="くり返し">
              <div className="grid gap-2 sm:grid-cols-2">
                <ChoiceCard
                  selected={repeatYearly}
                  title="毎年くり返す"
                  note="誕生日など。年が変わるたびに送ります"
                  onClick={() => setRepeatYearly(true)}
                />
                <ChoiceCard
                  selected={!repeatYearly}
                  title="1回だけ"
                  note="契約更新日など。その日が来たら1度だけ"
                  onClick={() => setRepeatYearly(false)}
                />
              </div>
            </Field>
          </>
        )}

        <Field
          label="送るタイミングの決め方"
          note="**作成したあとは変えられません。** 途中で変えると、すでに登録済みの人の配信予定がすべて変わってしまうためです。"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              selected={deliveryMode === 'time'}
              title="○日前の●時"
              note="「3日前の10時」のように、日付と時刻で決めます"
              onClick={() => setDeliveryMode('time')}
            />
            <ChoiceCard
              selected={deliveryMode === 'countdown'}
              title="ゴールからの残り時間"
              note="「1時間前」のように、そこからの長さで決めます"
              onClick={() => setDeliveryMode('countdown')}
            />
          </div>
        </Field>

        {deliveryMode === 'time' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="何日ずらすか" htmlFor="rm-offset-days" note="マイナスが前、プラスが後。">
              <div className="flex items-center gap-1.5">
                <input
                  id="rm-offset-days"
                  type="number"
                  value={offsetDays}
                  onChange={(e) => setOffsetDays(parseInt(e.target.value, 10) || 0)}
                  className={`${inputClass} w-24`}
                />
                <span className="text-ink-faint text-xs whitespace-nowrap">
                  日{offsetDays < 0 ? '前' : offsetDays > 0 ? '後' : '（当日）'}
                </span>
              </div>
            </Field>
            <Field label="その日の何時に" htmlFor="rm-step-time">
              <input
                id="rm-step-time"
                type="time"
                value={stepSendAtTime}
                onChange={(e) => setStepSendAtTime(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        <div className={`grid gap-3 sm:grid-cols-2 ${deliveryMode === 'time' ? 'hidden' : ''}`}>
          <Field label="どれだけ前に送るか" htmlFor="rm-offset">
            <SelectField
              id="rm-offset"
              value={offsetMinutes}
              onChange={(e) => setOffsetMinutes(Number(e.target.value))}
              aria-label="リマインダを送るまでの時間"
              className={inputClass}
              options={OFFSETS.map((offset) => ({ value: String(offset.minutes), label: offset.label }))}
            />
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
            <SelectField
              id="rm-tag"
              value={targetTagId}
              onChange={(e) => setTargetTagId(e.target.value)}
              aria-label="リマインダ対象を絞り込むタグ"
              className={inputClass}
              options={tags.length === 0
                ? [{ value: '', label: '（タグがありません）' }]
                : tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            />
          </Field>
        )}
      </FormSection>

      <FormSection
        step={4}
        label="送る内容"
        note="テンプレートから呼び出すか、直接入力します。"
      >
        <Field
          label="テンプレートから選ぶ"
          htmlFor="rm-template"
          note="選ぶと、下の本文の代わりにテンプレートの中身が届きます。"
        >
          <SelectField
            id="rm-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            aria-label="リマインダに使うテンプレート"
            className={inputClass}
            options={[
              { value: '', label: '使わない（下に直接書く）' },
              ...templates.map((template) => ({ value: template.id, label: template.name })),
            ]}
          />
        </Field>

        <Field
          label="本文"
          htmlFor="rm-body"
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

        <label className="text-ink-secondary flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={activateNow}
            onChange={(e) => setActivateNow(e.target.checked)}
          />
          <span>
            作成したらすぐ動かす
            <span className="text-ink-faint block text-xs">
              オフにすると下書きとして保存され、条件に合っても送られません。あとから編集画面で
              動かせます。
            </span>
          </span>
        </label>
      </FormSection>
    </CreatePage>
  )
}
