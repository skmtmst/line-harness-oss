'use client'

import { storedStringList } from '@/lib/stored-json'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check } from 'lucide-react'
import { CreatePage } from '@/components/templates/create-page'
import PreviewLauncher from '@/components/templates/preview-launcher'
import { CreateSummaryCard } from '@/components/templates/create-parts'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import PageResourceScope, { usePageResourceTask } from '@/components/shell/page-resource-scope'
import { resolveResourceTitle } from '@/lib/resource-title'
import Button from '@/components/shared/button'
import Card, { CardHeader } from '@/components/shared/card'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import DateTimeField from '@/components/shared/date-time-field'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import NumberInput from '@/components/shared/number-field'
import Select from '@/components/shared/select'
import TargetMissing from '@/components/shared/target-missing'
import { Field } from '@/components/shared/form-controls'
import { SettingsFormRow } from '@/components/shared/settings-form-card'
import { TextField } from '@/components/shared/text-field'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { notifySaved } from '@/components/shared/toast'
import { emptyValue } from '@/components/shared/empty-value'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'
import { formatDateTime as polishFormatDateTime, formatYen } from '@/lib/format'
import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantMenuItem } from '@/lib/restaurant-test-api'
import { MenuPaymentFields, PaymentConflictError, PaymentSideCard, useMenuPayment } from '@/v8/booking-payments/public/menu-payment/index'
import styles from './edit.module.css'

/*
 * ★V8 メニュー管理 › コース・単品の編集（修正案 f4bLF の mauOC）。1枚の編集ページ＋右の説明カード。
 * 前の「追加・変更の窓」は消し、一覧の［変更］［メニューを追加する］はここへ来る。
 * 受け付ける指定：?id=<品目>（変更）・?store=<店舗>（追加）。
 * 送る形は前の窓と同じ（createMenu／updateMenu。価格変更は確認後に確定）。お支払いはコースだけ。
 * 「受ける人数」は今のデータに無いので置かない（口待ち）。所要時間は読むだけ。
 */

type Period = 'lunch' | 'dinner' | 'both'
type Draft = { kind: 'course' | 'a_la_carte'; name: string; price: string; period: Period; effectiveAt: string; allergens: string; status: 'draft' | 'active' }
const LIST_HREF = '/restaurant-test/menu'


function periodLabel(periods: string[]): string {
  return periods.map((period) => (period === 'lunch' ? 'ランチ' : 'ディナー')).join('・') || emptyValue('unknown')
}
function draftOf(item: RestaurantMenuItem | null): Draft {
  if (!item) return { kind: 'course', name: '', price: '', period: 'dinner', effectiveAt: '', allergens: '', status: 'draft' }
  const periods = storedStringList(item.service_periods_json)
  return {
    kind: item.kind, name: item.name, price: String(item.price),
    period: periods.length > 1 ? 'both' : periods[0] === 'lunch' ? 'lunch' : 'dinner',
    effectiveAt: '', allergens: storedStringList(item.allergens_json).join(', '), status: item.status === 'draft' ? 'draft' : 'active',
  }
}

function MenuEditBody() {
  const captureResource = usePageResourceTask()
  const params = useSearchParams()
  const id = params.get('id')
  const storeParam = params.get('store')
  const router = useRouter()
  const saveErrors = useSaveFormErrors()
  const { selectedAccountId } = useAccount()
  const canEdit = canManageRole(useStaffRole())
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [item, setItem] = useState<RestaurantMenuItem | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(draftOf(null))
  const [saved, setSaved] = useState<Draft>(draftOf(null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmingPrice, setConfirmingPrice] = useState(false)
  const [confirmingPublish, setConfirmingPublish] = useState(false)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setState('loading')
    try {
      const response = await restaurantTestApi.snapshot(selectedAccountId)
      const found = id ? response.data.menuItems.find((row) => row.id === id) ?? null : null
      setItem(found)
      setStoreId(found?.store_id ?? storeParam ?? response.data.stores[0]?.id ?? null)
      setDraft(draftOf(found)); setSaved(draftOf(found))
      setState('ready')
    } catch {
      setState('error')
    }
  }, [selectedAccountId, id, storeParam])
  useEffect(() => { void load() }, [load])

  const editing = item
  const course = draft.kind === 'course'
  const payment = useMenuPayment('course', selectedAccountId, editing && editing.kind === 'course' ? editing.id : null)
  const priceChanged = Boolean(editing && draft.price !== '' && Number(draft.price) !== editing.price)
  const priceStartsAt = draft.effectiveAt ? new Date(datetimeLocalJstToUtcIso(draft.effectiveAt)) : null
  const priceStartsLater = Boolean(priceStartsAt && priceStartsAt.getTime() > Date.now())
  const dirty = state === 'ready' && (JSON.stringify(draft) !== JSON.stringify(saved) || payment.dirty)
  const pendingTitle = id ? 'メニューを編集' : course ? 'コースを追加する' : 'メニューを追加する'
  const title = resolveResourceTitle({ name: editing?.name, loaded: state === 'ready', pendingTitle })
  usePageTitle(title)
  usePageCrumbs([{ label: 'メニュー管理', href: LIST_HREF }])
  const valid = draft.name.trim() !== '' && draft.price !== '' && Number(draft.price) >= 0

  const contextKey = JSON.stringify([selectedAccountId, id, storeParam])
  const mutationContext = useRef<{ key: string; menuSignature: string | null }>({ key: contextKey, menuSignature: null })
  if (mutationContext.current.key !== contextKey) mutationContext.current = { key: contextKey, menuSignature: null }
  useEffect(() => { setBusy(false); setDeleting(false); setConfirmingPrice(false); setConfirmingPublish(false); setError(null) }, [contextKey])

  async function save() {
    if (!canEdit || !selectedAccountId || !valid) return
    const isCurrent = captureResource()
    if (!isCurrent()) return
    const attempt = mutationContext.current
    const stillHere = () => isCurrent() && mutationContext.current === attempt
    setBusy(true); setError(null)
    const body = {
      kind: draft.kind, name: draft.name, price: Number(draft.price),
      effectiveAt: draft.effectiveAt ? datetimeLocalJstToUtcIso(draft.effectiveAt) : null,
      allergens: draft.allergens.split(',').map((part) => part.trim()).filter(Boolean),
      servicePeriods: draft.period === 'both' ? ['lunch', 'dinner'] : [draft.period],
    }
    try {
      if (editing) {
        const updateBody = { ...body, ...(editing.status === 'draft' && draft.status === 'active' ? { status: 'active' } : {}) }
        const signature = JSON.stringify([editing.id, updateBody])
        if (attempt.menuSignature !== signature) {
          await restaurantTestApi.updateMenu(selectedAccountId, editing.id, updateBody)
          attempt.menuSignature = signature
        }
        if (editing.kind === 'course') await payment.save(editing.id)
        if (!stillHere()) return
        notifySaved(priceChanged ? (priceStartsLater ? '価格変更を確定しました。指定した開始日時に反映します。' : '価格を変更しました。') : 'メニューを更新しました。')
      } else {
        if (!storeId) throw new Error('store_missing')
        await restaurantTestApi.createMenu(selectedAccountId, { storeId, ...body, status: draft.status })
        if (!stillHere()) return
        notifySaved(draft.status === 'draft' ? '下書きのメニューを追加しました。' : 'メニューを公開しました。')
      }
      if (!stillHere()) return
      setSaved(draft)
      router.push(LIST_HREF)
      return true
    } catch (cause) {
      if (!stillHere()) return
      /* お支払いの版が古い（409）ときは共通の帯と比べる窓で選んでもらう。ページの中身は保存済み。 */
      if (cause instanceof PaymentConflictError) { setSaved(draft); setError('メニュー本体は保存しました。お支払いの設定は、閉じて最新の内容と比べてください。'); return false }
      saveErrors.capture(cause)
      setError('保存できませんでした。入力を確かめて、もう一度お試しください。')
      return false
    } finally {
      if (stillHere()) setBusy(false)
    }
  }

  async function remove() {
    if (!editing || !selectedAccountId) return
    const isCurrent = captureResource()
    if (!isCurrent()) return
    const attempt = mutationContext.current
    const stillHere = () => isCurrent() && mutationContext.current === attempt
    setBusy(true); setError(null)
    try {
      await fetchApi(`/api/restaurant-test/menus/${encodeURIComponent(editing.id)}?account_id=${encodeURIComponent(selectedAccountId)}`, { method: 'DELETE' })
      if (!stillHere()) return
      notifySaved('メニューを削除しました。')
      setSaved(draft)
      router.push(LIST_HREF)
      return true
    } catch (error) {
      if (!stillHere()) return
      setError(japaneseDetailOf(error) || '削除できませんでした。')
      return false
    } finally {
      if (stillHere()) setBusy(false)
    }
  }

  const side = useMemo(() => (
    <div className={styles.side}>
      <PaymentSideCard title="決済をつないでいない店のとき">「お支払い」の段は出さず、この 1 行だけ出します（押せない形にしない）。</PaymentSideCard>
      <PaymentSideCard title="お客さまの見え方">予約の 5 段目に「お支払い」が出て、Stripe の支払いページへ進みます。払い終わると予約が決まります。払われないと仮の予約は取り消します。</PaymentSideCard>
    </div>
  ), [])

  if (!selectedAccountId) return <ListState kind="empty" title="アカウントを選択してください。" />
  if (state === 'loading') return <ListState kind="loading" title="メニューを読み込んでいます" />
  if (state === 'error') return <ListState kind="error" title="メニューを読み込めませんでした" onRetry={() => void load()} />
  if (id && !editing) return <TargetMissing kind="unspecified" title="このメニューは見つかりません" description="一覧から、変更するメニューを選び直してください。" backHref={LIST_HREF} backLabel="メニュー管理へ戻る" />

  const draftItem = editing?.status === 'draft'
  return (
    <SaveErrorScope errors={saveErrors}>
      <CreatePage
        boardId="mauOC"
        dirty={dirty && !busy}
        busy={busy}
        readOnly={!canEdit}
        title={<span className={styles.title}><span className={styles.titleParent}>メニュー管理 ›</span>{title}</span>}
        help={<>コースと単品の名前・値段・提供時間・アレルギーと、お支払いの方法を決めます。価格変更は確認して保存すると確定します。</>}
        preview={side}
        previewSurface="plain"
        previewToggle={<PreviewLauncher title="お支払いの説明" label="お支払いの説明を見る">{side}</PreviewLauncher>}
        destructive={canEdit && editing ? <Button variant="text" textTone="danger" onClick={() => { setError(null); setDeleting(true) }} disabled={busy}>削除する</Button> : undefined}
        footerActions={<>
          <Button onClick={() => router.push(LIST_HREF)} disabled={busy}>キャンセル</Button>
          {canEdit ? <Button variant="primary" busy={busy} disabled={!valid || (Boolean(editing) && !dirty)} disabledReason={editing && !dirty ? "変更していません" : undefined} onClick={() => { setError(null); if ((!editing || draftItem) && draft.status === 'active') setConfirmingPublish(true); else if (priceChanged) setConfirmingPrice(true); else void save() }}><Check size={16} aria-hidden="true" />{editing ? '保存する' : '保存して追加する'}</Button> : null}
        </>}
      >
        {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
        {canEdit ? (
          <Card variant="form" gap="normal">
            <CardHeader size="stacked" title="基本" />
            {!editing || draftItem ? <Field label="保存する状態" help="下書きは、お客さまに見せるメニューには出ません。内容を確かめてから公開できます。">
              <SaveErrorField names={['status', 'draft.status']}><Select aria-label="保存する状態" size="full" value={draft.status} onChange={(value) => setDraft({ ...draft, status: value === 'active' ? 'active' : 'draft' })} options={[{ value: 'draft', label: '下書き' }, { value: 'active', label: '公開' }]} /></SaveErrorField>
            </Field> : null}
            <SettingsFormRow layout="columns" columns={3}>
              <Field label={course ? 'コースの名前' : 'メニューの名前'} htmlFor="rs-menu-name" required>
                <SaveErrorField names={['name', 'draft.name']}><TextField id="rs-menu-name" aria-label="メニュー名" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></SaveErrorField>
              </Field>
              <Field label={course ? '1名の値段' : '値段'} htmlFor="rs-menu-price" required error={draft.price !== '' && Number(draft.price) < 0 ? '値段は0円以上で入れてください。' : undefined}>
                <SaveErrorField names={['price', 'draft.price']}><NumberInput id="rs-menu-price" aria-label="価格（税込）" unit="円" type="number" min={0} required value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></SaveErrorField>
              </Field>
              <Field label="所要時間（変更不可）" htmlFor="rs-menu-duration" optional={false}>
                <TextField id="rs-menu-duration" aria-label="時間" disabled value={editing?.duration_minutes ? `${editing.duration_minutes} 分` : emptyValue('unknown')} />
              </Field>
            </SettingsFormRow>
            <SettingsFormRow layout="columns" columns={3}>
              <Field label="種類">
                <SaveErrorField names={['kind', 'draft.kind']}><Select aria-label="種類" size="full" value={draft.kind} onChange={(value) => setDraft({ ...draft, kind: value === 'a_la_carte' ? 'a_la_carte' : 'course' })} options={[{ value: 'course', label: 'コース' }, { value: 'a_la_carte', label: '単品' }]} /></SaveErrorField>
              </Field>
              <Field label="出す時間帯">
                <SaveErrorField names={['period', 'draft.period']}><Select aria-label="提供時間" size="full" value={draft.period}
                  onChange={(value) => setDraft({ ...draft, period: value === 'lunch' ? 'lunch' : value === 'both' ? 'both' : 'dinner' })}
                  options={[{ value: 'lunch', label: 'ランチ' }, { value: 'dinner', label: 'ディナー' }, { value: 'both', label: 'ランチ・ディナー' }]} /></SaveErrorField>
              </Field>
              <Field label={editing ? '新しい価格の開始日時' : '価格の開始日時'} htmlFor="rs-menu-effective">
                <SaveErrorField names={['effectiveAt', 'draft.effectiveAt', 'effective_at', 'draft.effective_at']}><DateTimeField id="rs-menu-effective" aria-label={editing ? '新しい価格の開始日時' : '価格の開始日時'} value={draft.effectiveAt} onChange={(next) => setDraft({ ...draft, effectiveAt: next })} /></SaveErrorField>
              </Field>
            </SettingsFormRow>
            <Field label="アレルギー（カンマ区切り）" htmlFor="rs-menu-allergens">
              <SaveErrorField names={['allergens', 'draft.allergens']}><TextField id="rs-menu-allergens" value={draft.allergens} onChange={(event) => setDraft({ ...draft, allergens: event.target.value })} /></SaveErrorField>
            </Field>
            <p className={styles.note}>{editing
              ? `価格を変える場合は保存時に確認します。開始日時を空欄にすると保存後すぐに反映します。現在の価格は${formatYen(editing.price)}です。`
              : '追加したメニューは、予約台帳・Google投稿・LINEカードで同じマスターとして使われます。'}</p>
          </Card>
        ) : (
          <CreateSummaryCard title="メニューの内容" description={editing?.pendingPrice != null ? (editing.priceChangeStatus === 'approved' ? '確定した新価格は指定した開始日時に反映します。' : '以前の価格変更申請が残っています。メニュー一覧から確認してください。') : undefined} rows={[
            { label: '種類', value: draft.kind === 'course' ? 'コース' : '単品' },
            { label: 'メニュー名', value: draft.name || emptyValue('unconfigured') },
            { label: '価格（税込）', value: editing ? formatYen(editing.price) : emptyValue('unconfigured') },
            ...(editing?.pendingPrice != null ? [{ label: '変更予定の価格', value: formatYen(editing.pendingPrice) }] : []),
            { label: '提供時間', value: editing ? periodLabel(storedStringList(editing.service_periods_json)) : emptyValue('unknown') },
            { label: '所要時間', value: editing?.duration_minutes ? `${editing.duration_minutes}分` : emptyValue('unknown') },
            { label: 'アレルギー', value: draft.allergens || emptyValue('none') },
            { label: '変更後の価格の開始日時', value: editing?.pendingEffectiveAt ? polishFormatDateTime(new Date(editing.pendingEffectiveAt)) : emptyValue('unconfigured') },
          ]} />
        )}
        {course && editing ? (
          <Card variant="form" gap="normal">
            <CardHeader size="stacked" title="お支払い" help={<HelpTip label="お支払いの説明">先払いのときは、予約の最後に Stripe の支払いページへ進みます。</HelpTip>} />
            <MenuPaymentFields state={payment} name="course" price={draft.price === '' ? editing.price : Number(draft.price)} people={1} readOnly={!canEdit} />
          </Card>
        ) : course && canEdit ? <p className={styles.note}>お支払いの方法は、コースを追加したあとにこのページで決められます。</p> : null}
      </CreatePage>
      <ConfirmDialog open={deleting} title="このメニューを削除しますか？" description={`「${editing?.name ?? ''}」を削除します。予約や設定で使われていないメニューだけ削除できます。元に戻せません。`}
        confirmLabel="削除する" destructive busy={busy} onCancel={() => setDeleting(false)} error={error || undefined} onSuccess={() => setDeleting(false)} onConfirm={() => remove()} />
      <ConfirmDialog open={confirmingPrice} title="価格変更を確定しますか？"
        description={`${editing?.name ?? 'メニュー'}の価格を${formatYen(editing?.price ?? 0)}から${formatYen(Number(draft.price))}へ変更します。${priceStartsLater && priceStartsAt ? `${polishFormatDateTime(priceStartsAt)}に新価格を反映します。` : '保存後すぐに新価格を反映します。'}`}
        confirmLabel="確定して保存する" busy={busy} onCancel={() => setConfirmingPrice(false)} error={error || undefined} confirmDisabled={Boolean(payment.conflict.conflict)} confirmDisabledReason="閉じてお支払いの最新の内容と比べてください。" onSuccess={() => setConfirmingPrice(false)} onConfirm={() => save()} />
      <ConfirmDialog open={confirmingPublish} title="このメニューを公開しますか？" description="保存すると、予約などで使えるメニューになります。名前・価格・提供時間を確かめてください。価格の変更は指定した開始日時から反映されます。"
        confirmLabel={editing ? '公開して保存する' : '公開して追加する'} busy={busy} error={error || undefined} onCancel={() => setConfirmingPublish(false)} onSuccess={() => setConfirmingPublish(false)} onConfirm={() => { if (priceChanged) { setConfirmingPrice(true); return true }; return save() }} />
    </SaveErrorScope>
  )
}

export default function RestaurantMenuEditPage() {
  return <Suspense fallback={<ListState kind="loading" />}><PageResourceScope queryKeys={['id', 'store']}><MenuEditBody /></PageResourceScope></Suspense>
}
