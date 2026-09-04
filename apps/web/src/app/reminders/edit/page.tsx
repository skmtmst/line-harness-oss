'use client'

import ReminderPublishFlow, {
  type ReminderPublishStage,
} from '@/components/reminders/reminder-publish-flow'
import SelectField from '@/components/shared/select-field'
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Reminder, ReminderStep, Tag } from '@line-crm/shared'
import { describeReminderTiming } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import StickyBar from '@/components/shared/sticky-bar'

/**
 * リマインダの編集。
 *
 * 作れるのに直せない状態だった。名前を打ち間違えても、送る時刻を変えたくなっても、
 * 作り直すしかなかった。
 *
 * **配信方式（○日前の●時／残り時間）はここで変えられない。** 途中で変えると、
 * すでに登録済みの人の配信予定がすべて変わる。「3日前」で予約が入っている人が、
 * 突然「4320分前」の解釈に切り替わる。作るときに決めたものを守る。
 */

const inputClass =
  'border-hairline rounded-control focus:ring-accent block w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none'

type StepDraft = {
  offsetDays: number
  sendAtTime: string
  offsetMinutes: number
  messageContent: string
  /** テンプレートから選ぶ場合の id。選ぶと本文の代わりにそちらが送られる。 */
  templateId: string
}

function emptyStep(mode: 'time' | 'countdown'): StepDraft {
  return {
    offsetDays: -1,
    sendAtTime: '10:00',
    offsetMinutes: mode === 'time' ? 0 : -1440,
    messageContent: '',
    templateId: '',
  }
}

/**
 * 公開までの段（設計 7-1-C〜G）。`?stage=` が付いていたらそちらへ渡す。
 *
 * **同じ `/reminders/edit` のまま段を切り替える。** 別のルートにすると、
 * 直しに戻るたびに URL が変わり、どこまで進んだのか分からなくなる。
 */
const PUBLISH_STAGES = new Set<ReminderPublishStage>(['target', 'preview', 'test', 'confirm', 'done'])

function ReminderEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const rawStage = params.get('stage')
  if (rawStage && PUBLISH_STAGES.has(rawStage as ReminderPublishStage)) {
    if (!id) {
      return <p className="text-danger p-6 text-sm">リマインダが指定されていません。</p>
    }
    return <ReminderPublishFlow reminderId={id} stage={rawStage as ReminderPublishStage} />
  }
  return <LegacyReminderEditInner />
}

function LegacyReminderEditInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''

  const [reminder, setReminder] = useState<(Reminder & { steps: ReminderStep[] }) | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // 編集する値
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [targetTagId, setTargetTagId] = useState('')
  const [sendAtTime, setSendAtTime] = useState('')
  const [newStep, setNewStep] = useState<StepDraft>(emptyStep('countdown'))
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([])

  /** 押した時点の通を掴んでおく。一覧が読み直されても、窓の対象は動かさない。 */
  const [deleteStep, setDeleteStep] = useState<ReminderStep | null>(null)
  const [deletingStep, setDeletingStep] = useState(false)
  const [deleteStepError, setDeleteStepError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await api.reminders.get(id)
      if (!res.success) {
        setError(res.error)
        return
      }
      setReminder(res.data)
      setName(res.data.name)
      setDescription(res.data.description ?? '')
      setIsActive(res.data.isActive)
      setTargetTagId(res.data.targetTagId ?? '')
      setSendAtTime(res.data.sendAtTime ?? '')
      setNewStep(emptyStep(res.data.deliveryMode === 'time' ? 'time' : 'countdown'))
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
    void api.templates.list().then((res) => {
      if (res.success) setTemplates(res.data.map((t) => ({ id: t.id, name: t.name })))
    })
  }, [load])

  const mode = reminder?.deliveryMode === 'time' ? 'time' : 'countdown'

  async function handleSave() {
    if (!name.trim()) {
      setError('リマインダ名を入力してください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.reminders.update(id, {
        name: name.trim(),
        description: description.trim() || null,
        isActive,
        targetTagId: targetTagId || null,
        sendAtTime: sendAtTime || null,
      })
      if (!res.success) throw new Error(res.error)
      setMessage('保存しました')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddStep() {
    // テンプレートを選んでいれば本文は要らない。どちらも空なら何も届かない。
    if (!newStep.templateId && !newStep.messageContent.trim()) {
      setError('送る内容を入力するか、テンプレートを選んでください')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.reminders.addStep(id, {
        offsetMinutes: mode === 'time' ? 0 : newStep.offsetMinutes,
        messageType: 'text',
        // テンプレートを選んでいても本文は残す。テンプレートを消したときに、
        // ここが送られる（参照が切れて何も届かなくなるのを防ぐ）。
        messageContent: newStep.messageContent.trim() || '（テンプレートから送ります）',
        offsetDays: mode === 'time' ? newStep.offsetDays : null,
        sendAtTime: mode === 'time' ? newStep.sendAtTime : null,
        templateId: newStep.templateId || null,
      })
      if (!res.success) throw new Error(res.error)
      setNewStep(emptyStep(mode))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  /*
   * 通の削除。**ブラウザの `confirm()` は使わない。**
   * 「よろしいですか」だけでは、何が消えて何が残るのかが読めなかった。
   * 見た目もブラウザ任せで、画像比較にも写らない。
   */
  async function handleDeleteStep() {
    // 二度押しを受け付けない。押している間は窓も閉じない。
    if (!deleteStep || deletingStep) return
    setDeletingStep(true)
    setDeleteStepError('')
    try {
      const res = await api.reminders.deleteStep(id, deleteStep.id)
      // 返事を見ずに読み直すと、消えていないのに消えたように見える。
      if (!res.success) throw new Error(res.error)
      setDeleteStep(null)
      await load()
    } catch {
      // 生のAPIエラーは出さない。運用者が次にすることだけを書く。
      setDeleteStepError('この通を削除できませんでした。読み直してから、もう一度お試しください。')
    } finally {
      setDeletingStep(false)
    }
  }

  if (!id) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-danger text-sm">id が指定されていません</p>
        <Link href="/reminders" className="text-info mt-2 inline-block text-sm hover:underline">
          ← 一覧に戻る
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <nav className="text-ink-faint mb-2 text-xs">
        <Link href="/reminders" className="hover:underline">
          リマインダ
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || '編集'}</span>
      </nav>

      <Header
        title="リマインダを編集"
        description="名前・送る相手・通の中身を変えられます。送るタイミングの決め方は、作ったときのまま変わりません。"
      />

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-3 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-success-bg mb-4 rounded-lg p-3 text-sm text-green-700">{message}</div>
      )}

      {loading ? (
        <p className="text-ink-faint text-sm">読み込み中...</p>
      ) : !reminder ? (
        <p className="text-ink-faint text-sm">リマインダが見つかりません</p>
      ) : (
        <div className="space-y-6">
          <section className="bg-canvas border-hairline rounded-card space-y-4 border p-5">
            <h2 className="text-ink text-sm font-semibold">基本</h2>

            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">リマインダ名</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>

            <label className="block">
              <span className="text-ink-secondary text-xs font-medium">説明</span>
              <span className="text-ink-faint block text-[11px]">管理用のメモです。</span>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`mt-1 resize-y ${inputClass}`}
              />
            </label>

            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                動かす
                <span className="text-ink-faint block text-[11px]">
                  切ると下書きになります。条件に合っても送られません。すでに登録されている人にも届きません。
                </span>
              </span>
            </label>
          </section>

          <section className="bg-canvas border-hairline rounded-card space-y-4 border p-5">
            <div>
              <h2 className="text-ink text-sm font-semibold">送るタイミングの決め方</h2>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                作ったときに決めたもので、ここでは変えられません。変えると、すでに登録済みの人の
                配信予定がすべて変わってしまうためです。変えたいときは新しく作り直してください。
              </p>
            </div>
            <p className="bg-canvas-sunken rounded-control px-3 py-2 text-sm">
              {mode === 'time' ? '○日前の●時' : 'ゴールからの残り時間'}
            </p>

            {reminder.triggerType !== 'manual' && (
              <label className="block">
                <span className="text-ink-secondary text-xs font-medium">送る時刻</span>
                <span className="text-ink-faint block text-[11px]">
                  空にすると、予約の時刻を起点にずらして届きます。
                </span>
                <input
                  type="time"
                  value={sendAtTime}
                  onChange={(e) => setSendAtTime(e.target.value)}
                  className={`mt-1 w-40 ${inputClass}`}
                />
              </label>
            )}
          </section>

          <section className="bg-canvas border-hairline rounded-card space-y-4 border p-5">
            <div>
              <h2 className="text-ink text-sm font-semibold">誰に送るか</h2>
              <p className="text-ink-faint mt-0.5 text-xs">
                タグを選ぶと、そのタグを持つ人だけに送ります。
              </p>
            </div>
            <SelectField
              value={targetTagId}
              onChange={(e) => setTargetTagId(e.target.value)}
              options={[{ value: '', label: '対象になった友だち全員' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </section>

          <section className="bg-canvas border-hairline rounded-card space-y-4 border p-5">
            <div>
              <h2 className="text-ink text-sm font-semibold">送る通</h2>
              <p className="text-ink-faint mt-0.5 text-xs leading-relaxed">
                ゴール日時を起点に、この並びで届きます。通が1つも無いと、対象に加わっても
                何も届きません。
              </p>
            </div>

            {reminder.steps.length === 0 ? (
              <p className="text-[11px] text-amber-600">
                通がありません。このままだと何も届きません。
              </p>
            ) : (
              <ul className="space-y-2">
                {reminder.steps.map((step) => (
                  <li
                    key={step.id}
                    className="border-hairline rounded-control flex items-start justify-between gap-3 border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-ink text-xs font-semibold">
                        {describeReminderTiming(
                          {
                            offsetDays: step.offsetDays,
                            sendAtTime: step.sendAtTime,
                            offsetMinutes: step.offsetMinutes,
                          },
                          mode,
                        )}
                      </div>
                      <p className="text-ink-secondary mt-1 text-sm whitespace-pre-wrap">
                        {step.messageContent}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setDeleteStepError('')
                        setDeleteStep(step)
                      }}
                      className="shrink-0 text-xs text-red-600 hover:underline"
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-hairline space-y-3 border-t pt-4">
              <p className="text-ink-secondary text-xs font-medium">通を足す</p>

              {mode === 'time' ? (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="text-ink-faint text-xs">何日ずらすか</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        type="number"
                        value={newStep.offsetDays}
                        onChange={(e) =>
                          setNewStep({
                            ...newStep,
                            offsetDays: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        className={`w-24 ${inputClass}`}
                      />
                      <span className="text-ink-faint text-xs whitespace-nowrap">
                        日{newStep.offsetDays < 0 ? '前' : newStep.offsetDays > 0 ? '後' : '（当日）'}
                      </span>
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-ink-faint text-xs">その日の何時に</span>
                    <input
                      type="time"
                      value={newStep.sendAtTime}
                      onChange={(e) => setNewStep({ ...newStep, sendAtTime: e.target.value })}
                      className={`mt-1 w-32 ${inputClass}`}
                    />
                  </label>
                </div>
              ) : (
                <label className="block">
                  <span className="text-ink-faint text-xs">ゴールから何分ずらすか</span>
                  <span className="text-ink-faint block text-[11px]">
                    マイナスが前。-1440 で1日前です。
                  </span>
                  <input
                    type="number"
                    value={newStep.offsetMinutes}
                    onChange={(e) =>
                      setNewStep({ ...newStep, offsetMinutes: parseInt(e.target.value, 10) || 0 })
                    }
                    className={`mt-1 w-32 ${inputClass}`}
                  />
                </label>
              )}

              <label className="block">
                <span className="text-ink-faint text-xs">テンプレートから選ぶ</span>
                <span className="text-ink-faint block text-[11px]">
                  選ぶと、下の本文の代わりにテンプレートの中身が届きます。
                </span>
                <SelectField
                  value={newStep.templateId}
                  onChange={(e) => setNewStep({ ...newStep, templateId: e.target.value })}
                  options={[{ value: '', label: '使わない（下に直接書く）' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]}
                />
              </label>

              <label className="block">
                <span className="text-ink-faint text-xs">送る内容</span>
                <span className="text-ink-faint block text-[11px]">
                  {'{{name}}'} は、送るときに一人ひとりの名前へ置き換わります。
                </span>
                <textarea
                  rows={3}
                  value={newStep.messageContent}
                  onChange={(e) => setNewStep({ ...newStep, messageContent: e.target.value })}
                  placeholder="例：{{name}}さん、明日のご予約のお知らせです。"
                  className={`mt-1 resize-y ${inputClass}`}
                />
              </label>

              <button
                onClick={() => void handleAddStep()}
                disabled={saving}
                className="border-hairline rounded-control hover:bg-canvas-sunken border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              >
                この通を足す
              </button>
            </div>
          </section>

          <StickyBar
            actions={(
              <>
                <Link
                  href="/reminders"
                  className="border-hairline rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium transition-colors"
                >
                  一覧へ戻る
                </Link>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </>
            )}
          />
        </div>
      )}

      {/*
        取り消せないので `destructive` を付ける。通を消すと
        `reminder_steps` の行が消え、`friend_reminder_deliveries` は
        `reminder_step_id ... ON DELETE CASCADE` なので、この通を届けた
        記録も一緒に消える（`packages/db/schema.sql`）。
      */}
      <ConfirmDialog
        open={deleteStep !== null}
        title="この通を削除しますか？"
        description="この1通だけを削除します。リマインダ本体と、ほかの通は残ります。この操作は取り消せません。"
        confirmLabel="削除する"
        destructive
        busy={deletingStep}
        error={deleteStepError}
        onConfirm={() => void handleDeleteStep()}
        onCancel={() => {
          if (deletingStep) return
          setDeleteStep(null)
          setDeleteStepError('')
        }}
      >
        {deleteStep && (
          <div className="space-y-2 text-xs leading-5">
            <p className="text-ink font-semibold">
              {describeReminderTiming(
                {
                  offsetDays: deleteStep.offsetDays,
                  sendAtTime: deleteStep.sendAtTime,
                  offsetMinutes: deleteStep.offsetMinutes,
                },
                mode,
              )}
            </p>
            <p className="text-ink-secondary line-clamp-3 whitespace-pre-wrap">
              {deleteStep.messageContent}
            </p>
            <ul className="text-ink-secondary space-y-1">
              <li>・止まること: このタイミングの配信は、これから誰にも届きません。</li>
              <li>・消えること: この通を届けた記録も一緒に消えます。</li>
              <li>・残ること: 登録済みの人と、ほかの通の予定はそのままです。</li>
              {reminder?.steps.length === 1 && (
                <li className="text-warning">
                  ・これが最後の1通です。消すと、対象に加わっても何も届かなくなります。
                </li>
              )}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </main>
  )
}

export default function ReminderEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<p className="text-ink-faint p-6 text-sm">読み込み中...</p>}>
      <ReminderEditInner />
    </Suspense>
  )
}
