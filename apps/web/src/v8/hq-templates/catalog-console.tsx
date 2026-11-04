'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HqCatalogTemplateDefinition, HqCatalogTemplateType } from '@line-crm/shared'
import { ListPage, CreatePage } from '@/components/templates'
import { DistributionPage } from '@/components/templates/distribution-page'
import Button from '@/components/shared/button'
import { Field } from '@/components/shared/form-controls'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import ResourceTable from '@/components/shared/resource-table'
import { Tabs } from '@/components/shared/tabs'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { hqTemplatesApi, type Preflight, type Resolution } from '@/lib/hq-templates-api'
import { hqCatalogTemplatesApi, type CatalogRedistributionPreview } from '@/lib/api/helpers/hq-catalog-templates'
import HqAccountPicker from './account-picker'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import styles from '@/v8/hq-deliveries/console.module.css'

type Detail = Awaited<ReturnType<typeof hqCatalogTemplatesApi.detail>>['data']
type View = 'list' | 'edit' | 'accounts' | 'confirm' | 'result'
const label = (type: HqCatalogTemplateType) => type === 'booking_menu' ? '予約メニュー' : 'マイルの景品'
const initial = (type: HqCatalogTemplateType): HqCatalogTemplateDefinition => type === 'booking_menu'
  ? { schemaVersion: 1, settings: { name: '', duration_minutes: 60, base_price: 0, price_mode: 'fixed', paymentMode: 'default' } }
  : { schemaVersion: 1, settings: { name: '', rewardKind: 'coupon', requiredMiles: 100 } }

export default function CatalogConsole({ type }: { type: HqCatalogTemplateType }) {
  const router = useRouter()
  const role = useStaffRole(), canEdit = role !== null && canManageRole(role)
  const [view, setView] = useState<View>('list')
  const [rows, setRows] = useState<Detail['template'][]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [selected, setSelected] = useState<string[]>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [redistribution, setRedistribution] = useState<CatalogRedistributionPreview | null>(null)
  const [isRedistribution, setIsRedistribution] = useState(false)
  const [result, setResult] = useState<Array<{ accountId: string; status: string }>>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const savedSnapshot = useRef('')
  const dirty = view === 'edit' && JSON.stringify(detail) !== savedSnapshot.current
  const guard = useUnsavedGuard({ dirty, busy, onDiscard: () => setDetail(null) })
  const load = useCallback(async () => {
    try { const data = await hqCatalogTemplatesApi.list(type); setRows(data.data); setError('') }
    catch { setError('ひな形を読み込めませんでした。ページを読み直してください。') }
  }, [type])
  useEffect(() => { void load(); void hqTemplatesApi.accounts().then(setAccounts).catch(() => setError('配布先を読み込めませんでした。')) }, [load])
  const open = async (row: Detail['template'], next: View = 'edit', redistribute = false) => {
    setBusy(true); setError('')
    try { const loaded=(await hqCatalogTemplatesApi.detail(row.id)).data; savedSnapshot.current=JSON.stringify(loaded); setDetail(loaded); setSelected([]); setPreflight(null); setRedistribution(null); setIsRedistribution(redistribute); setView(next) }
    catch { setError('ひな形を開けませんでした。読み直してください。') }
    finally { setBusy(false) }
  }
  const create = () => { requestId.current = crypto.randomUUID(); const created={ template: { id: '', name: '', template_type: type, revision: 0 }, definition: initial(type) }; savedSnapshot.current=JSON.stringify(created); setDetail(created); setView('edit'); setError('') }
  const settings = detail?.definition.settings as unknown as Record<string, unknown> | undefined
  const change = (key: string, value: unknown) => setDetail(old => old ? { ...old, definition: { ...old.definition, settings: { ...old.definition.settings, [key]: value } } as HqCatalogTemplateDefinition } : old)
  const save = async () => {
    if (!detail || !canEdit || busy) return
    setBusy(true); setError('')
    try {
      const input = { name: detail.template.name, definition: detail.definition }
      const saved = detail.template.id ? await hqCatalogTemplatesApi.update(detail.template.id, { ...input, expectedRevision: detail.template.revision }) : await hqCatalogTemplatesApi.create({ ...input, type, requestId: requestId.current })
      savedSnapshot.current=JSON.stringify(saved.data); guard.disarm(); setDetail(saved.data); setView('accounts'); setSelected([]); setIsRedistribution(false); await load()
    } catch { setError('保存できませんでした。入力と最新の版を確認してください。') }
    finally { setBusy(false) }
  }
  const prepare = async () => {
    if (!detail || !canEdit || busy || !selected.length) return
    setBusy(true); setError('')
    try {
      if (isRedistribution) setRedistribution((await hqCatalogTemplatesApi.redistributionPreview(detail.template.id, selected)).data)
      else {
        const p = (await hqCatalogTemplatesApi.preflight(detail.template.id, selected)).data
        setPreflight(p); setChoices(Object.fromEntries(p.stores.flatMap(s => s.items.filter(i => i.allowedModes.length === 1).map(i => [`${s.accountId}:${i.sourceId}`, i.allowedModes[0]]))))
      }
      setView('confirm')
    } catch { setError('配る前の確認ができませんでした。選んだアカウントと内容を確認してください。') }
    finally { setBusy(false) }
  }
  const distribute = async () => {
    if (!detail || !canEdit || busy) return
    setBusy(true); setError('')
    try {
      if (redistribution) setResult((await hqCatalogTemplatesApi.redistribute(detail.template.id, redistribution)).data.stores)
      else if (preflight) {
        const resolutions = preflight.stores.flatMap(store => store.items.map(item => ({ accountId: store.accountId, sourceId: item.sourceId, mode: choices[`${store.accountId}:${item.sourceId}`] as Resolution['mode'] })))
        if (resolutions.some(item => !item.mode)) { setError('それぞれの配り方を選んでください。'); return }
        setResult((await hqCatalogTemplatesApi.distribute(detail.template.id, preflight.preflightId, resolutions)).data.stores)
      } else return
      setView('result'); await load()
    } catch { setError('配布結果を確認できませんでした。同じ確認内容で再試行してください。') }
    finally { setBusy(false) }
  }
  const notices = <><ConfirmDialog open={guard.leaveTarget !== null} title="入力を破棄しますか？" description="保存していないひな形の変更があります。" primaryAction="cancel" cancelLabel="編集を続ける" confirmLabel="保存せずに移る" busy={busy} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />{!canEdit && <Notice tone="info">閲覧のみで見ています。</Notice>}{error && <Notice tone="warn">{error}</Notice>}</>
  const tabs = <Tabs label="ひな形の種類" items={[{ id: 'template', label: 'メッセージなど', onClick: () => router.push('/hq/templates') }, ...(['booking_menu','mileage_reward'] as const).map(id => ({ id, label: label(id), current: type === id, onClick: () => router.push(`/hq/templates?type=${id}`) }))]} />
  if (view === 'list') return <ListPage title={`${label(type)}を配る`} tabs={tabs} actions={canEdit ? <Button variant="primary" onClick={create}>ひな形を作る</Button> : undefined}>{notices}<ResourceTable canEdit={canEdit} updatedLabel="版" rows={rows.map(row => ({ id: row.id, name: <Button variant="text" onClick={() => void open(row)}>{row.name}</Button>, summary: label(type), references: null, updated: `版 ${row.revision}`, destinations: '—', actions: <><Button onClick={() => void open(row,'accounts',false)} disabled={busy}>配る</Button><Button onClick={() => void open(row,'accounts',true)} disabled={busy}>再配布</Button></> }))} /></ListPage>
  if (view === 'edit' && detail) {
    const field = (key: string, text: string, numeric = false) => <Field label={text}><TextField disabled={!canEdit || busy} inputMode={numeric ? 'numeric' : undefined} value={String(settings?.[key] ?? '')} onChange={event => change(key, numeric ? Number(event.target.value) : event.target.value)} /></Field>
    return <CreatePage title={`${label(type)}のひな形を${detail.template.id ? '編集する' : '作る'}`} notice={notices} dirty={false} busy={busy} footerActions={<><Button onClick={() => guard.guarded(() => setView('list'))} disabled={busy}>戻る</Button>{canEdit && <Button variant="primary" onClick={() => void save()} disabled={busy || !detail.template.name.trim() || !String(settings?.name ?? '').trim()}>保存する</Button>}</>}>
      <div className={styles.fields}><Field label="統括での名前"><TextField value={detail.template.name} disabled={!canEdit || busy} onChange={event => setDetail({ ...detail, template: { ...detail.template, name: event.target.value } })} /></Field>{field('name','店に届く名前')}{field('description','説明')}
      {type === 'booking_menu' ? <>{field('duration_minutes','所要時間（分）',true)}{field('base_price','金額（円）',true)}{field('image_url','画像URL')}<Field label="支払い"><Select aria-label="支払い" value={String(settings?.paymentMode ?? 'default')} onChange={value => change('paymentMode',value)} disabled={!canEdit || busy} options={[{value:'default',label:'店の設定に従う'},{value:'onsite',label:'店頭で支払う'},{value:'online',label:'オンライン決済'}]} /></Field></> : <>{field('requiredMiles','必要なマイル',true)}{field('imageUrl','画像URL')}<Field label="1人あたりの交換上限（回）"><TextField inputMode="numeric" value={String(settings?.perFriendLimit ?? '')} disabled={!canEdit || busy} onChange={event => change('perFriendLimit',event.target.value ? Number(event.target.value) : null)} /></Field>{field('startsAt','交換開始日時')}{field('endsAt','交換終了日時')}<Field label="景品の種類"><Select aria-label="景品の種類" value={String(settings?.rewardKind ?? 'coupon')} onChange={value => change('rewardKind',value)} disabled={!canEdit || busy} options={[{value:'coupon',label:'クーポン'},{value:'tag',label:'タグ'},{value:'scenario',label:'シナリオ'},{value:'template',label:'メッセージ'},{value:'early_access',label:'先にお知らせ'},{value:'rank',label:'ランク'}]} /></Field>{settings?.rewardKind !== 'coupon' && field('commonActionName','店の共通アクション名')}</>}</div>
    </CreatePage>
  }
  const stateText: Record<string,string> = {current:'適用済み',update:'新版へ更新',approval_required:'店の確認待ち',kept:'店の版を維持',updated:'更新済み',version_conflict:'変更あり・再確認',succeeded:'配布済み',failed:'配布できませんでした'}
  return <DistributionPage boardId="meBRB" stats={null} toolbar={null} title={`${label(type)}を${isRedistribution ? '再配布' : '配布'}する`} help="確認した内容を各アカウントへ配ります。" notices={notices} actions={<><Button onClick={() => setView(view === 'confirm' ? 'accounts' : 'list')} disabled={busy}>戻る</Button>{canEdit && view !== 'result' && <Button variant="primary" disabled={busy || !selected.length} onClick={() => void (view === 'accounts' ? prepare() : distribute())}>{view === 'accounts' ? '配る先を確かめる' : '確認した内容で配る'}</Button>}{view === 'result' && <Button variant="primary" onClick={() => setView('list')}>完了</Button>}</>}>
    {view === 'accounts' && <HqAccountPicker title="配るアカウント" allowed={accounts} selected={selected} onChange={setSelected} disabled={!canEdit || busy} />}
    {view === 'confirm' && redistribution?.stores.map(store => <Notice key={store.accountId} tone="info">{store.accountName}：{stateText[store.state]}</Notice>)}
    {view === 'confirm' && preflight && <Notice tone="info">{type === 'booking_menu' ? '担当スタッフは各店で決めます。予約の受付は止めた状態で入ります。' : '引換コードは配りません。各店で入れてください。交換の受付は止めた状態で入ります。'}</Notice>}
    {view === 'confirm' && preflight?.stores.map(store => <Notice key={store.accountId} tone="info">{store.accountName}{store.warnings?.map(warning => <p key={warning}>{({same_name_exists:'同じ名前があります。予約メニューは新しく作ります。',payment_downgraded:'決済が未接続のため、お店で払う設定で入ります。',booking_not_used:'この店は予約を使っていません。',booking_reception_stopped:'予約の受付は止めた状態で入ります。',staff_selection_required:'担当スタッフは各店で決めてください。'} as Record<string,string>)[warning] ?? '配布前に店の設定を確認してください。'}</p>)}{store.items.map(item => <Field key={item.sourceId} label={item.name}><Select aria-label={`${store.accountName}：${item.name}の配り方`} value={choices[`${store.accountId}:${item.sourceId}`] ?? ''} onChange={value => setChoices(old => ({ ...old, [`${store.accountId}:${item.sourceId}`]: value }))} options={[{value:'',label:'選んでください'},...item.allowedModes.map(mode => ({value:mode,label:mode === 'create' ? '新しく作る' : mode === 'overwrite' ? '上書きする' : '別名で作る'}))]} /></Field>)}</Notice>)}
    {view === 'result' && result.map(store => <Notice key={store.accountId} tone={['updated','succeeded','current','kept','approval_required'].includes(store.status) ? 'info' : 'warn'}>{accounts.find(account => account.id === store.accountId)?.name ?? store.accountId}：{stateText[store.status] ?? '確認が必要です'}</Notice>)}
  </DistributionPage>
}
