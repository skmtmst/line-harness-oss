'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import {
  bookingApi,
  type BookingFormField,
  type BookingMessageSetting,
  type BookingSettingsResponse,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const MESSAGE_LABELS: Record<string, string> = {
  booking_requested: '新規予約リクエスト申請時',
  booking_approved: '新規予約リクエスト承認時',
  booking_rejected: '新規予約リクエスト否認時',
  change_requested: '変更リクエスト申請時',
  change_approved: '変更リクエスト承認時',
  change_rejected: '変更リクエスト否認時',
  cancel_requested: 'キャンセルリクエスト申請時',
  cancel_approved: 'キャンセルリクエスト承認時',
  cancel_rejected: 'キャンセルリクエスト否認時',
}

const FIELD_TYPES: Array<{ value: BookingFormField['field_type']; label: string }> = [
  { value: 'text', label: '1行テキスト' },
  { value: 'tel', label: '電話番号' },
  { value: 'date', label: '日付' },
  { value: 'textarea', label: '複数行テキスト' },
]

export default function BookingSettingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [draft, setDraft] = useState<BookingSettingsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setDraft(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setDraft(await bookingApi.getSettings(selectedAccountId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const urls = useMemo(() => {
    const liffId = selectedAccount?.liffId
    if (!liffId) return null
    const root = `https://liff.line.me/${encodeURIComponent(liffId)}/?page=salon-book&liffId=${encodeURIComponent(liffId)}`
    return { booking: root, history: `${root}&view=history` }
  }, [selectedAccount?.liffId])

  async function saveSettings() {
    if (!selectedAccountId || !draft) return
    setSaving('settings')
    setError(null)
    setNotice(null)
    try {
      const result = await bookingApi.updateSettings(selectedAccountId, draft.settings)
      setDraft({ ...draft, settings: result.settings })
      setNotice('基本設定を保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function saveFields() {
    if (!selectedAccountId || !draft) return
    setSaving('fields')
    setError(null)
    setNotice(null)
    try {
      const result = await bookingApi.updateFields(
        selectedAccountId,
        draft.fields.map((field, index) => ({ ...field, sort_order: (index + 1) * 10 })),
      )
      setDraft({ ...draft, fields: result.fields })
      setNotice('予約情報取得項目を保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function saveMessages() {
    if (!selectedAccountId || !draft) return
    setSaving('messages')
    setError(null)
    setNotice(null)
    try {
      await bookingApi.updateMessages(selectedAccountId, draft.messages)
      setNotice('LINE返信文を保存しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function addConnection() {
    if (!selectedAccountId || !calendarId.trim() || !accessToken.trim()) return
    setSaving('calendar')
    setError(null)
    try {
      const created = await bookingApi.addCalendarConnection(selectedAccountId, {
        calendar_id: calendarId.trim(),
        access_token: accessToken.trim(),
      })
      setCalendarId('')
      setAccessToken('')
      await load()
      setNotice(`Googleカレンダー「${created.calendar_id}」を追加しました`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied((current) => (current === url ? null : current)), 1600)
  }

  if (!selectedAccountId) {
    return (
      <div>
        <Header title="予約管理設定" description="予約の公開・受付・表示・LINE返信・外部連携をまとめて管理します" />
        <Empty>サイドバーでLINEアカウントを選択してください</Empty>
      </div>
    )
  }

  if (loading || !draft) {
    return (
      <div>
        <Header title="予約管理設定" description="予約の公開・受付・表示・LINE返信・外部連携をまとめて管理します" />
        <Empty>読み込み中…</Empty>
      </div>
    )
  }

  const settings = draft.settings
  const updateSettings = (patch: Partial<typeof settings>) =>
    setDraft({ ...draft, settings: { ...settings, ...patch } })

  return (
    <div className="space-y-6 pb-16">
      <Header
        title="予約管理設定"
        description="予約枠はスタッフ画面で登録したシフトだけから自動生成されます"
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Section title="公開設定とリッチメニューURL" description="イベント概要や別の予約枠は使いません。公開中でも、スタッフシフトがない日時は表示されません。">
        <Toggle
          checked={settings.is_public === 1}
          title="予約ページを公開する"
          description="OFFにすると予約URLを開いても新規予約を受け付けません。履歴確認は残ります。"
          onChange={(checked) => updateSettings({ is_public: checked ? 1 : 0 })}
        />
        {urls ? (
          <div className="mt-5 space-y-3">
            <UrlRow label="予約する" url={urls.booking} copied={copied === urls.booking} onCopy={copyUrl} />
            <UrlRow label="予約の確認" url={urls.history} copied={copied === urls.history} onCopy={copyUrl} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-amber-700">LIFF IDが未設定です。LINEアカウント設定で登録してください。</p>
        )}
      </Section>

      <Section title="予約アクション" description="予約・変更・キャンセルは、許可したものだけ表示され、すべてスタッフ承認が必要なリクエスト制です。">
        <div className="grid gap-3 lg:grid-cols-3">
          <Toggle checked={settings.allow_new_booking === 1} title="新規予約を許可" description="お客様が予約リクエストを送れます。" onChange={(v) => updateSettings({ allow_new_booking: v ? 1 : 0 })} />
          <Toggle checked={settings.allow_change_request === 1} title="予約変更を許可" description="確定前・確定後の日時変更を申請できます。" onChange={(v) => updateSettings({ allow_change_request: v ? 1 : 0 })} />
          <Toggle checked={settings.allow_cancel_request === 1} title="キャンセルを許可" description="キャンセル申請を管理画面で承認します。" onChange={(v) => updateSettings({ allow_cancel_request: v ? 1 : 0 })} />
        </div>
      </Section>

      <Section title="受付期間" description="スタッフシフトの日時を基準に、いつからいつまで申請できるかを制御します。">
        <div className="grid gap-5 lg:grid-cols-2">
          <SelectField label="受付開始" value={settings.reception_start_mode} onChange={(value) => updateSettings({ reception_start_mode: value as typeof settings.reception_start_mode })}>
            <option value="always">常に受け付ける</option>
            <option value="relative">予約日の一定日数前から</option>
            <option value="fixed">特定日時から</option>
          </SelectField>
          {settings.reception_start_mode === 'relative' && (
            <NumberField label="予約日の何日前から" value={settings.reception_start_days_before ?? 60} suffix="日前" onChange={(value) => updateSettings({ reception_start_days_before: value })} />
          )}
          {settings.reception_start_mode === 'fixed' && (
            <TextField type="datetime-local" label="受付開始日時" value={toLocalInput(settings.reception_start_at)} onChange={(value) => updateSettings({ reception_start_at: fromLocalInput(value) })} />
          )}
          <SelectField label="受付締切" value={settings.reception_end_mode} onChange={(value) => updateSettings({ reception_end_mode: value as typeof settings.reception_end_mode })}>
            <option value="until_start">予約開始まで</option>
            <option value="relative">予約開始の一定時間前</option>
            <option value="fixed">特定日時まで</option>
          </SelectField>
          {settings.reception_end_mode !== 'fixed' && (
            <NumberField label="予約開始の何分前まで" value={settings.reception_end_minutes_before} suffix="分前" onChange={(value) => updateSettings({ reception_end_minutes_before: value })} />
          )}
          {settings.reception_end_mode === 'fixed' && (
            <TextField type="datetime-local" label="受付締切日時" value={toLocalInput(settings.reception_end_at)} onChange={(value) => updateSettings({ reception_end_at: fromLocalInput(value) })} />
          )}
          <NumberField label="変更申請の締切" value={settings.change_deadline_minutes_before} suffix="分前" onChange={(value) => updateSettings({ change_deadline_minutes_before: value })} />
          <NumberField label="キャンセル申請の締切" value={settings.cancel_deadline_minutes_before} suffix="分前" onChange={(value) => updateSettings({ cancel_deadline_minutes_before: value })} />
        </div>
      </Section>

      <Section title="カレンダー表示" description="お客様画面の見せ方と、予約開始時刻を何分刻みで作るかを設定します。">
        <div className="grid gap-5 md:grid-cols-2">
          <SelectField label="表示形式" value={settings.calendar_view} onChange={(value) => updateSettings({ calendar_view: value as 'week' | 'month' })}>
            <option value="week">週間表示</option>
            <option value="month">月間表示</option>
          </SelectField>
          <SelectField label="予約時間の単位" value={String(settings.slot_interval_minutes)} onChange={(value) => updateSettings({ slot_interval_minutes: Number(value) })}>
            <option value="15">15分単位</option>
            <option value="30">30分単位（推奨）</option>
            <option value="60">60分単位</option>
          </SelectField>
        </div>
      </Section>

      <Section title="予約情報取得項目" description="初期項目は、お名前・フリガナ・電話番号・生年月日の4つです。表示、必須、名称、順番を変更できます。">
        <div className="space-y-3">
          {draft.fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 lg:grid-cols-[1fr_180px_1fr_auto]">
              <TextField label="項目名" value={field.label} onChange={(value) => updateField(draft, setDraft, index, { label: value })} />
              <SelectField label="入力形式" value={field.field_type} onChange={(value) => updateField(draft, setDraft, index, { field_type: value as BookingFormField['field_type'] })}>
                {FIELD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </SelectField>
              <TextField label="入力例" value={field.placeholder ?? ''} onChange={(value) => updateField(draft, setDraft, index, { placeholder: value || null })} />
              <div className="flex items-end gap-2">
                <MiniToggle label="表示" checked={field.is_active === 1} onChange={(v) => updateField(draft, setDraft, index, { is_active: v ? 1 : 0 })} />
                <MiniToggle label="必須" checked={field.is_required === 1} onChange={(v) => updateField(draft, setDraft, index, { is_required: v ? 1 : 0 })} />
                <button type="button" disabled={index === 0} onClick={() => moveField(draft, setDraft, index, -1)} className="rounded border px-2 py-2 disabled:opacity-30">↑</button>
                <button type="button" disabled={index === draft.fields.length - 1} onClick={() => moveField(draft, setDraft, index, 1)} className="rounded border px-2 py-2 disabled:opacity-30">↓</button>
                {field.is_system !== 1 && <button type="button" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })} className="rounded border border-red-200 px-2 py-2 text-red-600">削除</button>}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDraft({
            ...draft,
            fields: [...draft.fields, {
              id: `new:${crypto.randomUUID()}`,
              field_key: `custom_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`,
              label: '新しい項目',
              field_type: 'text',
              placeholder: null,
              is_required: 0,
              is_active: 1,
              sort_order: (draft.fields.length + 1) * 10,
              is_system: 0,
            }],
          })}
          className="mt-4 rounded-lg border border-green-600 px-4 py-2 text-sm font-semibold text-green-700"
        >
          ＋ 情報取得項目を追加
        </button>
        <SaveButton saving={saving === 'fields'} onClick={saveFields}>取得項目を保存</SaveButton>
      </Section>

      <Section title="予約アクション時のLINE返信" description="二重波括弧の変数は送信時に置換されます：{{menu_name}}、{{staff_name}}、{{starts_at}}、{{requested_starts_at}}">
        <div className="space-y-4">
          {draft.messages.map((message, index) => (
            <div key={message.event_key} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-800">{MESSAGE_LABELS[message.event_key] ?? message.event_key}</h3>
                <MiniToggle label="送信" checked={message.is_enabled === 1} onChange={(v) => updateMessage(draft, setDraft, index, { is_enabled: v ? 1 : 0 })} />
              </div>
              <textarea
                value={message.message_text.replaceAll('\\n', '\n')}
                onChange={(e) => updateMessage(draft, setDraft, index, { message_text: e.target.value })}
                rows={5}
                maxLength={5000}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-6"
              />
            </div>
          ))}
        </div>
        <SaveButton saving={saving === 'messages'} onClick={saveMessages}>LINE返信文を保存</SaveButton>
      </Section>

      <Section title="外部サービス連携：Googleカレンダー" description="予約リクエストを承認して「確定」になった時だけ自動登録し、変更承認・キャンセル承認にも追従します。">
        {draft.calendar_connections.length > 0 && (
          <div className="mb-5 space-y-3">
            {draft.calendar_connections.map((connection) => (
              <div key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-4">
                <div>
                  <div className="font-semibold text-gray-800">{connection.calendar_id}</div>
                  <div className="text-xs text-gray-500">認証情報 {connection.has_access_token ? '設定済み' : '未設定'}</div>
                </div>
                <button type="button" onClick={async () => {
                  if (!confirm('このGoogleカレンダー連携を削除しますか？')) return
                  await bookingApi.deleteCalendarConnection(selectedAccountId, connection.id)
                  await load()
                }} className="text-sm text-red-600">削除</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <TextField label="GoogleカレンダーID" value={calendarId} placeholder="例：meauty.u@gmail.com" onChange={setCalendarId} />
          <TextField type="password" label="Google OAuth アクセストークン" value={accessToken} placeholder="画面には再表示されません" onChange={setAccessToken} />
        </div>
        <button type="button" disabled={saving === 'calendar'} onClick={() => void addConnection()} className="mt-4 rounded-lg border border-green-600 px-4 py-2 text-sm font-semibold text-green-700 disabled:opacity-50">
          ＋ Googleカレンダー連携を追加
        </button>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SelectField label="同期先" value={settings.calendar_connection_id ?? ''} onChange={(value) => updateSettings({ calendar_connection_id: value || null })}>
            <option value="">同期しない</option>
            {draft.calendar_connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.calendar_id}</option>)}
          </SelectField>
          <Toggle
            checked={settings.google_sync_enabled === 1}
            title="予約確定時に自動同期する"
            description="同期失敗時も予約データはD1に安全に残ります。"
            onChange={(v) => updateSettings({ google_sync_enabled: v ? 1 : 0 })}
          />
        </div>
      </Section>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <SaveButton saving={saving === 'settings'} onClick={saveSettings}>基本設定を保存</SaveButton>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-gray-500">{description}</p>
      {children}
    </section>
  )
}

function Toggle({ checked, title, description, onChange }: { checked: boolean; title: string; description: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 accent-green-600" />
      <span><span className="block text-sm font-semibold text-gray-800">{title}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{description}</span></span>
    </label>
  )
}

function MiniToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-green-600" />{label}</label>
}

function TextField({ label, value, type = 'text', placeholder, onChange }: { label: string; value: string; type?: string; placeholder?: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span><div className="flex items-center gap-2"><input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /><span className="whitespace-nowrap text-sm text-gray-500">{suffix}</span></div></label>
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">{children}</select></label>
}

function SaveButton({ saving, onClick, children }: { saving: boolean; onClick: () => void | Promise<void>; children: React.ReactNode }) {
  return <button type="button" disabled={saving} onClick={() => void onClick()} className="mt-5 rounded-lg bg-green-600 px-6 py-2.5 text-sm font-semibold text-white shadow hover:bg-green-700 disabled:opacity-50">{saving ? '保存中…' : children}</button>
}

function UrlRow({ label, url, copied, onCopy }: { label: string; url: string; copied: boolean; onCopy: (url: string) => void }) {
  return <div className="flex flex-wrap items-center gap-2"><span className="w-28 text-sm font-semibold text-gray-700">{label}</span><input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs" /><button type="button" onClick={() => void onCopy(url)} className="rounded-lg bg-gray-800 px-4 py-2 text-xs font-semibold text-white">{copied ? 'コピー済' : 'コピー'}</button></div>
}

function Alert({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  return <div className={`rounded-lg border p-4 text-sm ${tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">{children}</div>
}

function updateField(draft: BookingSettingsResponse, setDraft: (value: BookingSettingsResponse) => void, index: number, patch: Partial<BookingFormField>) {
  setDraft({ ...draft, fields: draft.fields.map((field, i) => i === index ? { ...field, ...patch } : field) })
}

function moveField(draft: BookingSettingsResponse, setDraft: (value: BookingSettingsResponse) => void, index: number, direction: -1 | 1) {
  const fields = [...draft.fields]
  const next = index + direction
  if (next < 0 || next >= fields.length) return
  ;[fields[index], fields[next]] = [fields[next], fields[index]]
  setDraft({ ...draft, fields })
}

function updateMessage(draft: BookingSettingsResponse, setDraft: (value: BookingSettingsResponse) => void, index: number, patch: Partial<BookingMessageSetting>) {
  setDraft({ ...draft, messages: draft.messages.map((message, i) => i === index ? { ...message, ...patch } : message) })
}

function toLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}
