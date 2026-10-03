'use client'

/*
 * メニュー編集の窓。v7 一覧（page.tsx）と V8 予約設定（settings-v8.tsx）の
 * 両方から使う。動き（版付き保存・409時の読み直し・設備の割当・破棄確認）は
 * 変えず、見た目だけ共通 Dialog のものにそろえてある。
 */
import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { ApiError, bookingApi, type BookingMenu, type BookingResource } from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import { bookingErrorMessage, bookingMenuError } from './menu-validation'

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-secondary mb-1">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

/**
 * 空欄を「店舗の予約ルールを使う」として扱う数値欄（R92）。
 *
 * 空欄のメニューは Worker が店舗値で埋める（effectiveBookingRules）ため、
 * 「制限しない」とは案内しない。新規作成画面の placeholder とそろえる。
 */
export function NullableNumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          value={value ?? ''}
          placeholder="店舗設定"
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="border-hairline rounded-control focus:ring-accent w-full border px-3 h-10 text-sm tabular-nums focus:outline-none focus:ring-2"
        />
        <span className="text-ink-faint whitespace-nowrap text-xs">{unit}</span>
      </div>
    </Field>
  )
}

export function NumField({
  label,
  required,
  value,
  onChange,
}: { label: string; required?: boolean; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} required={required}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border-hairline rounded-control focus:ring-accent w-full border px-3 h-10 text-sm focus:outline-none focus:ring-2 tabular-nums"
      />
    </Field>
  )
}

export function EditMenuModal({
  menu,
  tags,
  accountId,
  canManageResources,
  canEdit,
  onSave,
  onReloadLatest,
  onResourcesSaved,
  onClose,
}: {
  menu: BookingMenu
  tags: Tag[]
  accountId: string | null
  canManageResources: boolean
  /** false のとき閲覧のみ。保存ボタンを無効化する（APIも403で拒否）。 */
  canEdit: boolean
  onSave: (m: BookingMenu) => Promise<void>
  /** 版競合(409)のとき。一覧を読み直して、この窓は閉じる。 */
  onReloadLatest: () => Promise<void>
  onResourcesSaved: (
    menuId: string,
    version: number,
    resources: NonNullable<BookingMenu['assigned_resources']>,
  ) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<BookingMenu>(menu)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [resources, setResources] = useState<BookingResource[]>([])
  const [resourceLoadError, setResourceLoadError] = useState<string | null>(null)
  const [resourceSaving, setResourceSaving] = useState(false)
  const [resourceMessage, setResourceMessage] = useState<string | null>(null)
  const [resourceAssignments, setResourceAssignments] = useState<Map<string, number>>(() => new Map(
    (menu.assigned_resources ?? []).map((item) => [item.resourceId, item.quantity]),
  ))
  const resourceSubmitRef = useRef(false)
  const resourceLoadGenerationRef = useRef(0)
  /** 破棄確認の表示。×・Esc・背景・キャンセルは dirty のときだけここへ寄せる。 */
  const [showDiscard, setShowDiscard] = useState(false)
  /*
   * R305: 未保存の変更があるか。フォームと設備の割当を開いた直後と比べ、
   * 変わっていれば閉じる前に破棄確認を挟む。保存の成否自体は submit 側の
   * 扱いのまま変えない。
   */
  const initialSnapshot = useRef<string | null>(null)
  if (initialSnapshot.current === null) {
    initialSnapshot.current = JSON.stringify({
      form: menu,
      resources: [...(menu.assigned_resources ?? [])]
        .map((item) => [item.resourceId, item.quantity] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    })
  }
  const dirty = JSON.stringify({
    form,
    resources: [...resourceAssignments.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  }) !== initialSnapshot.current
  /** 閉じる操作は共通 Dialog（×・Esc・背景）から全部ここへ集まる。 */
  function requestClose() {
    if (dirty && !saving) {
      setShowDiscard(true)
      return
    }
    onClose()
  }

  useEffect(() => {
    const generation = ++resourceLoadGenerationRef.current
    setResourceLoadError(null)
    setResources([])
    if (!accountId) return
    bookingApi.listResources(accountId)
      .then((response) => {
        if (resourceLoadGenerationRef.current === generation) {
          setResources(response.data.resources)
        }
      })
      .catch(() => {
        if (resourceLoadGenerationRef.current === generation) {
          setResourceLoadError('設備を読み込めませんでした。編集内容はそのままです。')
        }
      })
    return () => { resourceLoadGenerationRef.current += 1 }
  }, [accountId])

  /*
   * 候補は「今のアカウントの有効なタグ」だけ。api.tags.list() は見えている
   * アカウント全部と整理済み(archived)まで返すので、そのまま並べると別アカウントの
   * タグが選べてしまい、保存時に Worker が tag_not_found で落とす。新規作成画面
   * (new/page.tsx)と同じ絞り方にそろえ、保存側の検証と二重化する。
   */
  const tagCandidates = tags.filter(
    (t) => t.lineAccountId === accountId && t.status !== 'archived',
  )
  /*
   * 設定した後にタグが整理された既存メニューは、候補に無い ID を抱えたまま開く。
   * 黙って「なし」に見せると気付かないまま保存で消えるので、選択は残したまま
   * 何が起きたかを出して選び直させる。保存し直せば Worker 側の active 検証で
   * 400 になるため、ここで先に知らせる。
   */
  const storedTagId = form.auto_tag_id ?? null
  const danglingAutoTag = storedTagId != null && !tagCandidates.some((t) => t.id === storedTagId)
  const danglingTagName = tags.find((t) => t.id === storedTagId)?.name ?? null

  /** 数値欄に文字列が入らないよう、鍵と値の型をそろえる。 */
  function set<K extends keyof BookingMenu>(k: K, v: BookingMenu[K]) {
    setForm({ ...form, [k]: v })
  }

  async function submit() {
    const validationError = bookingMenuError({
      name: form.name,
      durationMinutes: form.duration_minutes,
      bufferAfterMinutes: form.buffer_after_minutes,
      sortOrder: form.sort_order,
      assignedStaffCount: form.assigned_staff?.length ?? 0,
    })
    if (validationError) {
      setErr(validationError)
      return
    }
    setSaving(true)
    setErr(null)
    setConflict(false)
    try {
      await onSave(form)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 窓は閉じず、読み直してからやり直す流れをここに出す。
        setConflict(true)
        setErr('ほかの担当者が先に保存しました。最新の内容を読み直してから、もう一度変更してください。')
      } else {
        setErr(bookingErrorMessage(e, '保存'))
      }
    } finally {
      setSaving(false)
    }
  }

  function toggleResource(resourceId: string, checked: boolean) {
    setResourceMessage(null)
    setResourceAssignments((current) => {
      const next = new Map(current)
      if (checked) next.set(resourceId, current.get(resourceId) ?? 1)
      else next.delete(resourceId)
      return next
    })
  }

  function setResourceQuantity(resourceId: string, quantity: number) {
    setResourceMessage(null)
    setResourceAssignments((current) => new Map(current).set(resourceId, quantity))
  }

  async function submitResources() {
    if (resourceSubmitRef.current || !accountId) return
    const submissionGeneration = resourceLoadGenerationRef.current
    const expectedVersion = form.version
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      setResourceMessage('最新のメニュー情報を読み直してから、もう一度お試しください。')
      return
    }
    const selected = [...resourceAssignments.entries()].map(([resourceId, quantity]) => ({ resourceId, quantity }))
    if (selected.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000)) {
      setResourceMessage('必要数は1〜1000の整数で入力してください。')
      return
    }
    resourceSubmitRef.current = true
    setResourceSaving(true)
    setResourceMessage(null)
    try {
      const response = await bookingApi.saveMenuResources(accountId, menu.id, {
        expectedVersion: Number(expectedVersion), resources: selected,
      })
      if (resourceLoadGenerationRef.current !== submissionGeneration) return
      const assigned = selected.map((item) => {
        const candidate = resources.find((resource) => resource.id === item.resourceId)
          ?? menu.assigned_resources?.find((resource) => resource.resourceId === item.resourceId)
        return {
          menuId: menu.id,
          resourceId: item.resourceId,
          name: candidate?.name ?? '不明な設備',
          type: candidate && 'type' in candidate ? candidate.type : '',
          capacity: candidate?.capacity ?? item.quantity,
          quantity: item.quantity,
          isActive: candidate && 'isActive' in candidate ? candidate.isActive : false,
          warning: candidate && 'isActive' in candidate && candidate.isActive ? null : 'resource_inactive' as const,
        }
      })
      setForm((current) => ({ ...current, version: response.data.version, assigned_resources: assigned }))
      onResourcesSaved(menu.id, response.data.version, assigned)
      setResourceMessage('設備の割当を保存しました。新しい予約枠から反映されます。')
    } catch (error) {
      if (resourceLoadGenerationRef.current !== submissionGeneration) return
      setResourceMessage(error instanceof ApiError && error.status === 409
        ? 'ほかの担当者が先に保存しました。画面を閉じて最新の内容を読み直してください。'
        : '設備の割当を保存できませんでした。入力は残っています。もう一度お試しください。')
    } finally {
      resourceSubmitRef.current = false
      if (resourceLoadGenerationRef.current === submissionGeneration) setResourceSaving(false)
    }
  }

  /*
   * R305: 手作りの窓を共通の Dialog へ置き換えた。初期フォーカス・Tabの循環・
   * Esc取消・閉じた後の元ボタンへの復帰は共通部品が持つ。×・Esc・背景・
   * キャンセルは requestClose へ集め、未保存なら破棄確認を挟む。
   */
  return (
    <>
      <Dialog
        open
        title="メニュー編集"
        onCancel={requestClose}
        busy={saving}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={requestClose} disabled={saving}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void submit()}
              disabled={saving || !canEdit}
              title={canEdit ? undefined : '予約メニューの変更権限がありません'} busy={saving}>保存する
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="名前" required>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 h-10 text-sm focus:outline-none focus:ring-2"
              placeholder="例: カット"
            />
          </Field>
          <Field label="カテゴリ">
            <input
              type="text"
              value={form.category_label ?? ''}
              onChange={(e) => set('category_label', e.target.value)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 h-10 text-sm focus:outline-none focus:ring-2"
              placeholder="例: カット / カラー / パーマ"
            />
          </Field>
          <Field label="説明">
            <textarea
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className="border-hairline rounded-control focus:ring-accent w-full border px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-y"
              rows={2}
              placeholder="顧客に表示される説明文"
            />
          </Field>
          <Field label="料金の形" required>
            <Select
              aria-label="料金の形"
              value={form.price_mode ?? 'fixed'}
              onChange={(value) => {
                const mode = value as NonNullable<BookingMenu['price_mode']>
                // 無料・お問い合わせは金額を持たない。DB CHECK と Worker の
                // readPriceModeAndAmount に合わせて base_price=0 にそろえる。
                setForm((current) => ({
                  ...current,
                  price_mode: mode,
                  base_price: mode === 'fixed' ? current.base_price : 0,
                }))
              }}
              options={[
                { value: 'fixed', label: '固定料金' },
                { value: 'free', label: '無料' },
                { value: 'inquiry', label: 'お問い合わせ' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label="所要時間（分）"
              required
              value={form.duration_minutes ?? 60}
              onChange={(v) => set('duration_minutes', v)}
            />
            <NumField
              label="後バッファ（分）"
              value={form.buffer_after_minutes ?? 0}
              onChange={(v) => set('buffer_after_minutes', v)}
            />
            {(form.price_mode ?? 'fixed') === 'fixed' && (
              <NumField
                label="料金（円）"
                required
                value={form.base_price ?? 0}
                onChange={(v) => set('base_price', v)}
              />
            )}
            <NumField
              label="並び順"
              value={form.sort_order ?? 0}
              onChange={(v) => set('sort_order', v)}
            />
          </div>
          <Field label="予約申込時に自動付与するタグ">
            <Select
              aria-label="予約申込時に自動付与するタグ"
              value={form.auto_tag_id ?? ''}
              onChange={(value) => set('auto_tag_id', value === '' ? null : value)}
              options={[
                { value: '', label: '— なし —' },
                ...(danglingAutoTag
                  ? [{
                      value: storedTagId as string,
                      label: `${danglingTagName ?? '不明なタグ'}（今は使えません）`,
                    }]
                  : []),
                ...tagCandidates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            {danglingAutoTag && (
              <p className="mt-1 text-xs text-danger">
                設定されていたタグは整理済みか、このアカウントのタグではありません。選び直すか「なし」にしてください。
              </p>
            )}
            {!danglingAutoTag && tagCandidates.length === 0 && (
              <p className="mt-1 text-xs text-ink-faint">
                このアカウントに使えるタグがありません。タグなしで保存できます。
              </p>
            )}
            <p className="mt-1 text-xs text-ink-faint">
              このメニューが予約されると、申込者の友だちに自動でこのタグが付きます。タグは既存のものから選択してください (友だち画面 / シナリオ等で使われているタグ)。
            </p>
          </Field>

          <div className="border-hairline space-y-3 rounded-control border p-3">
            <div>
              <p className="text-ink-secondary text-sm font-semibold">このメニューで使う設備</p>
              <p className="text-ink-faint mt-1 text-xs">部屋・席・機材を複数選び、1件の予約に必要な数を指定します。</p>
            </div>
            {resourceLoadError ? (
              <p role="alert" className="text-danger text-xs">{resourceLoadError}</p>
            ) : resources.length === 0 && (menu.assigned_resources ?? []).length === 0 ? (
              <p className="text-ink-faint text-xs">利用できる設備がありません。設備設定で作成してください。</p>
            ) : (
              <div className="space-y-2">
                {[
                  ...resources,
                  ...(menu.assigned_resources ?? [])
                    .filter((assigned) => !resources.some((resource) => resource.id === assigned.resourceId))
                    .map((assigned) => ({
                      id: assigned.resourceId, name: assigned.name, type: assigned.type,
                      capacity: assigned.capacity, isActive: assigned.isActive,
                    } as BookingResource)),
                ].map((resource) => {
                  const checked = resourceAssignments.has(resource.id)
                  return (
                    <div key={resource.id} className="bg-canvas-sunken rounded-control flex items-center gap-3 p-2">
                      <Checkbox
                        checked={checked}
                        disabled={!canManageResources || (!resource.isActive && !checked)}
                        onCheckedChange={(value) => toggleResource(resource.id, value)}
                        className="min-w-0 flex-1"
                      >
                        <span className="truncate" title={resource.name}>{resource.name}</span>
                        {!resource.isActive && <span className="text-warning text-xs">停止中・新規受付不可</span>}
                        {resource.isActive && checked
                          && (resourceAssignments.get(resource.id) ?? 1) > resource.capacity
                          && <span className="text-warning text-xs">必要数が受付上限超過・新規受付不可</span>}
                      </Checkbox>
                      {checked && (
                        <label className="flex items-center gap-1 text-xs">
                          必要数
                          <input
                            aria-label={`${resource.name}の必要数`}
                            type="number" min={1} max={Math.min(1000, resource.capacity)}
                            value={resourceAssignments.get(resource.id) ?? 1}
                            disabled={!canManageResources || !resource.isActive}
                            onChange={(event) => setResourceQuantity(resource.id, Number(event.target.value))}
                            className="border-hairline rounded-control w-20 border px-2 py-1 tabular-nums"
                          />
                          / {resource.capacity}
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {canManageResources ? (
              <button
                type="button"
                onClick={() => void submitResources()}
                disabled={resourceSaving || resourceLoadError !== null}
                className="border-accent text-accent-deep rounded-control border px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {resourceSaving ? '設備の割当を保存中…' : '設備の割当を保存する'}
              </button>
            ) : (
              <p className="text-ink-faint text-xs">設備の割当は閲覧のみです。変更は管理者へ依頼してください。</p>
            )}
            {resourceMessage && <p role="status" className="text-xs text-ink-secondary">{resourceMessage}</p>}
          </div>

          {/* 受付条件。空欄は店舗の予約ルールを使う（新規作成画面と同じ）。 */}
          <div className="border-hairline space-y-3 rounded-control border p-3">
            <p className="text-ink-secondary text-sm font-semibold">受付条件</p>
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="同時に受ける件数"
                value={form.concurrent_capacity ?? 1}
                onChange={(v) => set('concurrent_capacity', v)}
              />
              <NullableNumField
                label="何日先まで受けるか"
                unit="日"
                value={form.booking_window_days ?? null}
                onChange={(v) => set('booking_window_days', v)}
              />
              <NullableNumField
                label="受付の締め切り"
                unit="時間前"
                value={form.cutoff_hours_before ?? null}
                onChange={(v) => set('cutoff_hours_before', v)}
              />
              <NullableNumField
                label="キャンセルの期限"
                unit="時間前"
                value={form.cancel_deadline_hours_before ?? null}
                onChange={(v) => set('cancel_deadline_hours_before', v)}
              />
            </div>
            <p className="text-ink-faint text-xs leading-relaxed">
              空欄は店舗の予約ルールを使います。<br />
              「同時に受ける件数」を2以上にすると、<strong>このメニュー同士だけ</strong>が同じ枠に入ります。
              別のメニューの予約が入っている時間には、件数にかかわらず入りません。<br />
              キャンセルの期限はお客様の画面に表示されます。管理画面からはいつでもキャンセルできます。
            </p>
            <Field label="予約時にお客様へ聞くこと">
              <input
                type="text"
                value={form.intake_question ?? ''}
                onChange={(e) => set('intake_question', e.target.value === '' ? null : e.target.value)}
                placeholder="例: 気になっている箇所はありますか？"
                maxLength={200}
                className="border-hairline rounded-control focus:ring-accent w-full border px-3 h-10 text-sm focus:outline-none focus:ring-2"
              />
              <p className="text-ink-faint mt-1 text-xs">
                空欄なら質問しません。回答は予約のメモとして残ります。
              </p>
            </Field>
          </div>

          <Checkbox
            checked={Boolean(form.is_active)}
            onCheckedChange={(value) => set('is_active', value ? 1 : 0)}
          >有効（顧客に表示する）</Checkbox>
          {err && (
            <div role="alert">
              <p className="text-danger text-xs">{err}</p>
              {conflict && (
                <button
                  type="button"
                  onClick={() => void onReloadLatest()}
                  className="text-action mt-1 text-xs font-semibold underline"
                >
                  最新の内容を読み直す
                </button>
              )}
            </div>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={showDiscard}
        title="変更を破棄しますか？"
        description="保存していない変更は消えます。閉じてよければ破棄を選んでください。"
        confirmLabel="破棄する"
        cancelLabel="編集に戻る"
        primaryAction="cancel"
        onConfirm={onClose}
        onCancel={() => setShowDiscard(false)}
      />
    </>
  )
}
