'use client'

/*
 * ★V8 通知と視聴後のこと（`E7iAYs`）。
 * v7 の見た目は 1画素も変えない。編集画面で data-theme="v8" のときだけ、
 * 通知の段をこの部品で描く（V7 の NotificationDesignStep は触らない）。
 *
 * 入り切りはその場で保存する。時刻・日数の字面は外れたときに保存する。
 * 視聴後の細かい条件は視聴後の段で変える（`onOpenActions` で段を移す）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import Toggle from '@/components/shared/toggle'
import LinePreview from '@/components/shared/line-preview'
import {
  webinarApi,
  type WebinarAction,
  type WebinarEditor,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
  type WebinarNotificationSettingsInput,
} from '@/lib/api'

const TRIGGER_LABEL: Record<WebinarAction['trigger'], string> = {
  completed: '視聴完了',
  cta_clicked: 'CTAクリック',
  unviewed: '未視聴',
}

export default function NotificationsV8({
  webinarId,
  webinarTitle,
  editor,
  onOpenActions,
}: {
  webinarId: string
  webinarTitle: string
  editor: WebinarEditor
  onOpenActions: () => void
}) {
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  const [overview, setOverview] = useState<WebinarNotificationOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [actions, setActions] = useState<WebinarAction[] | null>(null)
  const [testConfirmOpen, setTestConfirmOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await webinarApi.notifications(webinarId)
      setSettings(res.data.settings)
      setOverview(res.data.overview ?? null)
    } catch {
      setFailed(true)
    }
    try {
      const res = await webinarApi.actions(webinarId)
      setActions(res.data)
    } catch {
      setActions(null)
    }
  }, [webinarId])

  useEffect(() => {
    void load()
  }, [load])

  /** 入り切りの保存。失敗したら読み直して元に戻す。 */
  const save = async (next: WebinarNotificationSettingsInput) => {
    setBusy(true)
    setError('')
    try {
      const res = await webinarApi.saveNotifications(webinarId, next)
      setSettings(res.data.settings)
    } catch {
      setError('通知の設定を保存できませんでした。開き直して試してください。')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const flip = (key: keyof WebinarNotificationSettingsInput, value: boolean) => {
    if (!settings) return
    const next = { ...toInput(settings), [key]: value }
    setSettings({ ...settings, [key]: value } as WebinarNotificationSettings)
    void save(next)
  }

  const commitText = (key: 'dayBeforeTime' | 'hourBeforeMinutes' | 'missedTime' | 'missedWindowDays', raw: string) => {
    if (!settings) return
    if (key === 'hourBeforeMinutes' || key === 'missedWindowDays') {
      const num = Math.floor(Number(raw))
      if (!Number.isInteger(num) || num < 0) {
        setError('数は0以上で入れてください。')
        return
      }
      const next = { ...toInput(settings), [key]: num }
      setSettings({ ...settings, [key]: num } as WebinarNotificationSettings)
      void save(next)
      return
    }
    if (!/^\d{2}:\d{2}$/.test(raw)) {
      setError('時刻は「時:分」で入れてください（例 19:00）。')
      return
    }
    const next = { ...toInput(settings), [key]: raw }
    setSettings({ ...settings, [key]: raw } as WebinarNotificationSettings)
    void save(next)
  }

  const runTest = async () => {
    setTestConfirmOpen(false)
    setTesting(true)
    setTestResult('')
    try {
      const res = await webinarApi.testNotifications(webinarId)
      setTestResult(`テスト送信しました。成功 ${res.data.sent}件・失敗 ${res.data.failed}件`)
    } catch {
      setTestResult('テスト送信できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setTesting(false)
    }
  }

  const testDone = editor.notificationTest?.status === 'passed'

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="E7iAYs">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="通知とリマインド">
          <h2 className="text-ink text-base font-bold">通知とリマインド</h2>
          <p className="text-ink-faint mt-1 text-xs">LINE で送るお知らせです。テストは全部をまとめて自分に送ります。</p>
          {overview ? (
            <p className="mt-3 flex gap-4 text-sm" aria-label="送信の実績">
              <span><strong className="text-ink text-lg font-semibold tabular-nums">{overview.sent}</strong> <span className="text-ink-faint text-xs">送った</span></span>
              <span><strong className="text-ink text-lg font-semibold tabular-nums">{overview.failed}</strong> <span className="text-ink-faint text-xs">届かなかった</span></span>
              <span><strong className="text-ink text-lg font-semibold tabular-nums">{overview.skipped}</strong> <span className="text-ink-faint text-xs">見送り</span></span>
            </p>
          ) : null}
          {error ? <Notice tone="error" title="通知の設定">{error}</Notice> : null}
          {failed ? (
            <div className="mt-3">
              <Button onClick={() => void load()}>もう一度読み込む</Button>
            </div>
          ) : !settings ? (
            <p className="text-ink-faint py-6 text-center text-sm">通知の設定を読み込んでいます。</p>
          ) : (
            <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
              <ToggleRow
                label="申込のお礼"
                note="申し込んだらすぐ"
                checked={settings.registrationEnabled}
                disabled={busy}
                onChange={(next) => flip('registrationEnabled', next)}
              />
              <ToggleRow
                label="前日のご案内"
                checked={settings.dayBeforeEnabled}
                disabled={busy}
                onChange={(next) => flip('dayBeforeEnabled', next)}
              >
                前日の
                <TimeInput
                  ariaLabel="前日のご案内の時刻"
                  value={settings.dayBeforeTime}
                  disabled={busy || !settings.dayBeforeEnabled}
                  onCommit={(raw) => commitText('dayBeforeTime', raw)}
                />
              </ToggleRow>
              <ToggleRow
                label="開始前のお知らせ"
                checked={settings.hourBeforeEnabled}
                disabled={busy}
                onChange={(next) => flip('hourBeforeEnabled', next)}
              >
                開始の
                <NumberInput
                  ariaLabel="開始の何分前"
                  value={settings.hourBeforeMinutes}
                  disabled={busy || !settings.hourBeforeEnabled}
                  onCommit={(raw) => commitText('hourBeforeMinutes', raw)}
                />
                分前
              </ToggleRow>
              <ToggleRow
                label="開始のお知らせ"
                note="開始したとき"
                checked={settings.startEnabled}
                disabled={busy}
                onChange={(next) => flip('startEnabled', next)}
              />
              <ToggleRow
                label="見逃した人への案内"
                checked={settings.missedEnabled}
                disabled={busy}
                onChange={(next) => flip('missedEnabled', next)}
              >
                翌日の
                <TimeInput
                  ariaLabel="見逃した人への案内の時刻"
                  value={settings.missedTime}
                  disabled={busy || !settings.missedEnabled}
                  onCommit={(raw) => commitText('missedTime', raw)}
                />
                ・見られる期限
                <NumberInput
                  ariaLabel="見られる期限の日数"
                  value={settings.missedWindowDays}
                  disabled={busy || !settings.missedEnabled}
                  onCommit={(raw) => commitText('missedWindowDays', raw)}
                />
                日
              </ToggleRow>
              <ToggleRow
                label="見終わった人へのお礼"
                note="見終わったら"
                checked={settings.completedEnabled}
                disabled={busy}
                onChange={(next) => flip('completedEnabled', next)}
              />
            </ul>
          )}
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={testing || testDone || !settings}
              title={testDone ? 'テスト済みです' : undefined}
              busy={testing}
              busyLabel="送信中…"
              onClick={() => setTestConfirmOpen(true)}
            >
              {testDone ? 'テスト送信済み' : 'テストを送る（全部）'}
            </Button>
            {testResult ? <p className="text-ink-secondary mt-2 text-xs" role="status">{testResult}</p> : null}
          </div>
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="視聴後にすること">
          <h2 className="text-ink text-base font-bold">視聴後にすること</h2>
          <p className="text-ink-faint mt-1 text-xs">見たかどうかで、タグを付けたりシナリオを始めたりします。</p>
          <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
            {(['completed', 'cta_clicked', 'unviewed'] as const).map((trigger) => {
              const count = actions === null ? null : actions.filter((a) => a.trigger === trigger).length
              return (
                <li key={trigger} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-ink w-20 shrink-0 text-sm font-semibold">{TRIGGER_LABEL[trigger]}</span>
                  <span className="text-ink-secondary min-w-0 flex-1 truncate text-xs">
                    {count === null ? '読み込んでいます' : count === 0 ? 'まだ何もしない' : `${count}件の動き`}
                  </span>
                  <Button variant="secondary" size="compact" onClick={onOpenActions} aria-label={`${TRIGGER_LABEL[trigger]}の動きを変える`}>
                    …
                  </Button>
                </li>
              )
            })}
          </ul>
          <div className="mt-3">
            <Button variant="secondary" onClick={onOpenActions}>
              視聴後の段で変える
            </Button>
          </div>
        </section>
      </div>

      <aside className="w-full shrink-0 xl:w-95" aria-label="LINEでの見え方">
        <div className="border-hairline bg-canvas rounded-card border p-4 shadow-card xl:sticky xl:top-4">
          <h2 className="text-ink text-base font-bold">LINEでの見え方</h2>
          <div className="bg-canvas-sunken mt-2 rounded-control p-3">
            <LinePreview note="実際のLINE表示に近いプレビューです">
              <div className="bg-canvas text-ink rounded-control p-4 text-sm font-medium leading-relaxed">
                {`「${webinarTitle}」が始まりました。参加URLを添えて送ります。`}
              </div>
            </LinePreview>
          </div>
          <div className="mt-3">
            <Button
              variant="secondary"
              disabled={testing || testDone || !settings}
              busy={testing}
              busyLabel="送信中…"
              onClick={() => setTestConfirmOpen(true)}
            >
              テストを送る
            </Button>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={testConfirmOpen}
        title="通知をテスト送信しますか？"
        description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。"
        confirmLabel="テストを送る"
        busy={testing}
        onCancel={() => {
          if (!testing) setTestConfirmOpen(false)
        }}
        onConfirm={() => void runTest()}
      >
        <p className="text-ink-secondary text-xs">送る文面（開始のお知らせ）：「{webinarTitle}」が始まりました、という案内に参加URLを添えて送ります。</p>
      </ConfirmDialog>
    </div>
  )
}

function toInput(settings: WebinarNotificationSettings): WebinarNotificationSettingsInput {
  return {
    registrationEnabled: settings.registrationEnabled,
    dayBeforeEnabled: settings.dayBeforeEnabled,
    dayBeforeTime: settings.dayBeforeTime,
    hourBeforeEnabled: settings.hourBeforeEnabled,
    hourBeforeMinutes: settings.hourBeforeMinutes,
    startEnabled: settings.startEnabled,
    missedEnabled: settings.missedEnabled,
    missedTime: settings.missedTime,
    missedWindowDays: settings.missedWindowDays ?? 7,
    completedEnabled: settings.completedEnabled,
  }
}

function ToggleRow({
  label,
  note,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string
  note?: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
  children?: ReactNode
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="text-ink w-32 shrink-0 text-sm font-semibold">{label}</span>
      <span className="text-ink-secondary flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {note ?? children}
      </span>
      <Toggle label={label} checked={checked} onChange={disabled ? undefined : onChange} />
    </li>
  )
}

function TimeInput({
  ariaLabel,
  value,
  disabled,
  onCommit,
}: {
  ariaLabel: string
  value: string
  disabled: boolean
  onCommit: (raw: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      inputMode="numeric"
      placeholder="19:00"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text)
      }}
      className="border-hairline bg-canvas text-ink w-20 rounded-control border px-2 py-1 text-xs tabular-nums disabled:opacity-50"
    />
  )
}

function NumberInput({
  ariaLabel,
  value,
  disabled,
  onCommit,
}: {
  ariaLabel: string
  value: number
  disabled: boolean
  onCommit: (raw: string) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      inputMode="numeric"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== String(value)) onCommit(text)
      }}
      className="border-hairline bg-canvas text-ink w-16 rounded-control border px-2 py-1 text-xs tabular-nums disabled:opacity-50"
    />
  )
}
