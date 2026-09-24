'use client'

import { useEffect, useState } from 'react'
import Combobox from '@/components/shared/combobox'
import { api, describeSaveFailure } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import type {
  EntryRoute,
  CreateEntryRouteInput,
  TrafficPool,
  Scenario,
  Tag,
} from '@line-crm/shared'

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface Props {
  route: EntryRoute | null
  pools: TrafficPool[]
  scenarios: Scenario[]
  templates: MessageTemplate[]
  tags: Tag[]
  existingGenres: string[]
  initialGenre?: string
  /** Pre-filled ref_code for "register an unregistered inflow ref" flow. */
  initialRefCode?: string
  /**
   * #514-5: 親が一覧表示のために既に引いたプール別の所属名。渡されたら
   * 取り直さない。編集窓を開くたびの N+1 を無くす。
   */
  poolMemberNames?: Record<string, string[]>
  onClose: () => void
  onSaved: (savedRoute: EntryRoute, created: boolean) => void
}

export default function EditRouteModal({
  route,
  pools,
  scenarios,
  templates,
  tags,
  existingGenres,
  initialGenre,
  initialRefCode,
  poolMemberNames,
  onClose,
  onSaved,
}: Props) {
  // Per-pool member account names, loaded lazily so the dropdown can show
  // "Pool 名 — アカA, アカB" instead of just the pool name.
  const [poolMembers, setPoolMembers] = useState<Record<string, string[]>>(poolMemberNames ?? {})
  useEffect(() => {
    if (poolMemberNames) {
      setPoolMembers(poolMemberNames)
      return
    }
    let cancelled = false
    ;(async () => {
      const result = pools.length > 0
        ? await api.pools.listAccounts(
            pools.map((pool) => pool.id),
            { suppressFeatureDisabledEvent: true },
          ).catch(() => ({ success: false as const, data: [] }))
        : { success: true as const, data: [] }
      if (!cancelled && result.success) {
        setPoolMembers(Object.fromEntries(result.data.map(({ poolId, accounts }) => [
          poolId,
          accounts.filter((account) => account.isActive).map((account) => account.accountName ?? '—'),
        ])))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pools, poolMemberNames])
  const isNew = !route
  const mainPool = pools.find((p) => p.slug === 'main')
  // Unregistered-ref registration flow: refCode is fixed (the actual ref code
  // that has already been seen in inflow), so we lock the input to prevent
  // the user from accidentally renaming the ref and orphaning the prior stats.
  const refCodeLocked = isNew && !!initialRefCode
  const genreLocked = isNew && !!initialGenre
  const [form, setForm] = useState<CreateEntryRouteInput>(() => ({
    refCode: route?.refCode ?? initialRefCode ?? '',
    genre: route?.genre ?? initialGenre ?? '',
    name: route?.name ?? '',
    tagId: route?.tagId ?? null,
    poolId: route?.poolId ?? mainPool?.id ?? null,
    scenarioId: route?.scenarioId ?? null,
    introTemplateId: route?.introTemplateId ?? null,
    runAccountFriendAddScenarios: route?.runAccountFriendAddScenarios ?? true,
    redirectUrl: route?.redirectUrl ?? null,
    isActive: route?.isActive ?? true,
  }))
  const [submitting, setSubmitting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState('')

  const validateBeforeSave = () => {
    const nothingDelivers =
      !form.runAccountFriendAddScenarios && !form.scenarioId && !form.introTemplateId
    if (nothingDelivers) {
      setWarning(
        '上書きモードかつ起動シナリオも即時 push も未設定です。このリンクで友だち追加した人には何も届きません。続行しますか?',
      )
      return false
    }
    return true
  }

  const doSave = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = isNew
        ? await api.entryRoutes.create(form)
        : await api.entryRoutes.update(route!.id, form)
      if (res.success) onSaved(res.data, isNew)
      else setError(res.error ?? '保存に失敗しました。通信を確かめて、もう一度お試しください。')
    } catch (err) {
      // 400系はAPIの理由、403・5xxは運用の言葉へ写す（WRITE-01）。
      setError(describeSaveFailure(err))
    } finally {
      // 失敗時に「保存中…」のまま固まらないよう、必ず戻す。
      setSubmitting(false)
    }
  }

  const onSubmit = async () => {
    // If validation produced a warning, only the explicit "それでも保存"
    // button (which calls doSave directly) may bypass it. The main save
    // button must not be a second-click escape hatch.
    if (!validateBeforeSave()) return
    await doSave()
  }

  const saveDisabled = submitting || !form.genre?.trim() || !form.name.trim() || !form.refCode.trim()
  return (
    <Dialog
      open
      title={isNew ? '新規リファラルリンク' : 'リファラルリンク編集'}
      busy={submitting}
      error={error || undefined}
      onCancel={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={saveDisabled}
          >
            {submitting ? '保存中…' : isNew ? '作成' : '保存'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="ジャンル（協力会社・グループ）">
          <input
            list={genreLocked ? undefined : 'referral-genre-options'}
            value={form.genre ?? ''}
            onChange={(e) => setForm({ ...form, genre: e.target.value })}
            readOnly={genreLocked}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
            placeholder="例: A店"
            maxLength={80}
          />
          <datalist id="referral-genre-options">
            {existingGenres.map((genre) => <option key={genre} value={genre} />)}
          </datalist>
          <p className="text-ink-faint mt-1 text-xs">
            {genreLocked
              ? '左側で選択したジャンルへ登録されます。'
              : '同じ協力会社や媒体を同じジャンル名にすると、一覧でまとめて管理できます。'}
          </p>
        </Field>

        <Field label="名前（ジャンル内の流入経路）">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
            placeholder="例: Instagram プロフィール"
            maxLength={120}
          />
        </Field>

        <Field label="URLに出る識別子">
          <input
            value={form.refCode}
            onChange={(e) => setForm({ ...form, refCode: e.target.value })}
            disabled={refCodeLocked}
            className="border-hairline rounded-control bg-canvas text-ink disabled:bg-canvas-sunken disabled:text-ink-faint w-full border px-3 py-2 font-mono text-sm"
            placeholder="例: youtube"
          />
          {refCodeLocked && (
            <p className="text-ink-faint mt-1 text-xs">
              既に流入があった識別子を登録中のため、URLに出る識別子は変更できません。
            </p>
          )}
        </Field>

        <Field label="自動付与タグ（任意）">
          <Combobox
            aria-label="自動付与タグ（任意）"
            placeholder="— 設定なし —"
            value={form.tagId ?? ''}
            onChange={(next) => setForm({ ...form, tagId: next || null })}
            options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            className="w-full"
          />
          <p className="text-ink-faint mt-1 text-xs">
            友だち追加時にこのタグを自動付与します。タグ未作成の場合は先にタグを作成してください。
          </p>
        </Field>

        <Field label="送り先 Pool">
          <select
            value={form.poolId ?? ''}
            onChange={(e) => setForm({ ...form, poolId: e.target.value || null })}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm"
          >
            {pools.map((p) => {
              const members = poolMembers[p.id] ?? []
              const memberText =
                members.length === 0
                  ? '（アカウント未所属）'
                  : `— ${members.join(', ')}`
              return (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.slug === 'main' ? '（既定）' : ''} {memberText}
                </option>
              )
            })}
          </select>
        </Field>

        <Field label="起動シナリオ（任意）">
          <Combobox
            aria-label="起動シナリオ（任意）"
            placeholder="— 設定なし —"
            value={form.scenarioId ?? ''}
            onChange={(next) => setForm({ ...form, scenarioId: next || null })}
            options={scenarios.map((s) => ({ value: s.id, label: s.name }))}
            className="w-full"
          />
        </Field>

        <Field label="即時 push テンプレ（任意）">
          <Combobox
            aria-label="即時 push テンプレ（任意）"
            placeholder="— 設定なし —"
            value={form.introTemplateId ?? ''}
            onChange={(next) => setForm({ ...form, introTemplateId: next || null })}
            options={templates.map((t) => ({ value: t.id, label: t.name }))}
            className="w-full"
          />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.runAccountFriendAddScenarios ?? true}
            onChange={(e) => {
              setForm({
                ...form,
                runAccountFriendAddScenarios: e.target.checked,
              })
              setWarning(null)
            }}
            className="mt-0.5"
          />
          <span>
            アカウント標準の友だち追加時設定も実行する（並走モード）
            <span className="text-ink-faint mt-0.5 block text-xs">
              OFF にするとアカウント標準シナリオは抑止され、このリンクの設定だけが流れます。
            </span>
          </span>
        </label>

        {warning && (
          <div className="bg-status-warn-soft text-status-warn-deep rounded-control p-3 text-sm">
            {warning}
            <div className="mt-2">
              <Button
                onClick={doSave}
                disabled={submitting}
              >
                それでも保存
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-ink-secondary mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}
