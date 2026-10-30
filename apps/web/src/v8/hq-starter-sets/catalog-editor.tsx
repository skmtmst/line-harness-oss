'use client'
import { useCallback, useEffect, useState } from 'react'
import { STARTER_CATALOG_KINDS, type AccountStyle, type StarterCatalogOption, type StarterCatalogSelection } from '@line-crm/shared'
import Button from '@/components/shared/button'
import CategoryPanel from '@/components/shared/category-panel'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { EntityPickerField } from '@/components/shared/entity-picker'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { ToggleField } from '@/components/shared/toggle'
import { Tabs } from '@/components/shared/tabs'
import { notifySaved } from '@/components/shared/toast'
import { SettingsPage } from '@/components/templates/settings-page'
import { PageContent } from '@/components/templates/page-frame'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { hqStyleApi, type StyleStarterSet } from '@/lib/api/helpers/styles'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import { STYLE_CHOICES, styleLabel } from '@/v8/onboarding/public/model/index'
import { hqTemplateTabsForStarterSets } from '@/v8/hq-templates/public/store-list/index'
import styles from './catalog-editor.module.css'

type SwitchTarget = AccountStyle | 'save' | null
export default function CatalogStarterSets() {
  usePageTitle('スタイルの初期セット')
  const role = useStaffRole(), canEdit = canManageRole(role)
  const lock = role === null ? undefined : !canEdit ? '初期セットを変更できるのは統括の管理者だけです' : undefined
  const [sets, setSets] = useState<StyleStarterSet[] | null>(null)
  const [options, setOptions] = useState<StarterCatalogOption[] | null>(null)
  const [active, setActive] = useState<AccountStyle>('restaurant')
  const [selected, setSelected] = useState<StarterCatalogSelection[]>([])
  const [auto, setAuto] = useState(true), [dirty, setDirty] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<SwitchTarget>(null), [viewLegacy, setViewLegacy] = useState(false)
  const current = sets?.find(row => row.style === active)
  const catalogMode = current?.definition.mode === 'catalog'
  const load = useCallback(async () => {
    const [nextSets, nextOptions] = await Promise.all([hqStyleApi.listStarterSets(), hqStyleApi.catalog()])
    setSets(nextSets.data); setOptions(nextOptions.data)
    return nextSets.data
  }, [])
  const populate = (list: StyleStarterSet[], style: AccountStyle) => {
    const row = list.find(item => item.style === style)
    setSelected(row?.definition.mode === 'catalog' ? row.definition.selections ?? [] : [])
    setAuto(row?.autoInsert ?? true); setDirty(false); setError('')
  }
  useEffect(() => { let valid = true; void load().then(list => { if (valid) populate(list, 'restaurant') }).catch(caught => { if (valid) setError(describeApiFailure(caught, '読み込み', {scope:'hq'})) }); return () => { valid = false } }, [load])
  const switchStyle = (style: AccountStyle) => {
    if (style === active) return
    if (dirty) { setConfirm(style); return }
    setActive(style); populate(sets ?? [], style)
  }
  const save = async () => {
    if (!canEdit || busy || !sets || !options) return
    setBusy(true); setError('')
    try {
      await hqStyleApi.saveStarterSet(active, { expectedVersion: current?.version ?? 0, name: styleLabel(active), autoInsert: auto,
        definition: { mode: 'catalog', items: [], selections: selected }, confirmed: true })
      populate(await load(), active); setConfirm(null); notifySaved('初期セットを保存しました')
    } catch (caught) { setError(describeApiFailure(caught, '保存', {scope:'hq'})) }
    finally { setBusy(false) }
  }
  const rows = STYLE_CHOICES.map(row => ({id:row.value,label:styleLabel(row.value),count:sets?.find(set=>set.style===row.value)?.accountCount ?? null}))
  const legacy = current?.definition.items ?? []
  const loaded = sets !== null && options !== null
  return <SettingsPage title="スタイルの初期セット" heightMode="content" contentLayout="wide" readOnly={role === 'viewer' ? 'hq' : undefined}
    help="スタイルごとに、統括のカタログから最初に入れる物を選びます。保存だけでは既存のアカウントには配りません。"
    tabs={<Tabs size="compact" label="テンプレートの種類" items={hqTemplateTabsForStarterSets()} />}
    navigation={<CategoryPanel heading="スタイル" showHeading rows={rows} activeId={active} onSelect={id=>switchStyle(id as AccountStyle)} />}
    saveActions={<><Button disabled={busy || !dirty} onClick={()=>populate(sets ?? [],active)}>キャンセル</Button>
      <Button variant="primary" lockedReason={lock} disabled={busy || !loaded || !dirty || role===null} busy={busy} busyLabel="保存しています…"
        onClick={()=>!catalogMode || selected.length===0 ? setConfirm('save') : void save()}>変更を保存</Button></>}>
    <PageContent>
      {error ? <Notice tone="danger" action={!loaded ? <Button onClick={()=>void load().then(list=>populate(list,active)).catch(caught=>setError(describeApiFailure(caught,'読み込み',{scope:'hq'})))}>もう一度試す</Button> : undefined}>{error}</Notice> : null}
      {!loaded ? error ? null : <ListState kind="loading" /> : <>
        <div className={styles.head}><h2 className={styles.title}>{styleLabel(active)}の初期セット</h2>
          <StatusBadge tone="neutral">{catalogMode ? 'カタログから選択' : '従来の初期セット'}</StatusBadge>
          {!catalogMode ? <Button onClick={()=>setViewLegacy(true)}>現在の中身を見る</Button> : null}</div>
        <ToggleField checked={auto} disabled={busy || role===null} lockedReason={lock} onChange={value=>{setAuto(value);setDirty(true)}}
          description="新しいアカウントでこのスタイルを選んだときに入ります。">新しいアカウントへ自動で入れる</ToggleField>
        <GridTable label="最初に入れる物" design={{columns:'minmax(170px, 1fr) minmax(0, 1.7fr)',gap:'var(--space-16)',rowPadding:'0 var(--space-16)',fontSize:'var(--text-body)'}}>
          <GridHeadRow><GridCell role="columnheader">種類</GridCell><GridCell role="columnheader">統括のカタログから選ぶ</GridCell></GridHeadRow>
          {STARTER_CATALOG_KINDS.map(spec => {
            const choices = options.filter(option=>option.kind===spec.kind)
            const values = selected.filter(row=>row.kind===spec.kind).map(row=>row.versionId)
            const items = choices.map(option=>({id:option.versionId,name:option.name,meta:`版${option.version}`}))
            for (const id of values) if (!items.some(item=>item.id===id)) items.push({id,name:'選択済みの見本を読み込めません',meta:'選び直してください'})
            const update = (ids:string[]) => {
              const next = ids.map(id=>choices.find(option=>option.versionId===id)).filter((option):option is StarterCatalogOption=>Boolean(option))
              setSelected(old=>[...old.filter(row=>row.kind!==spec.kind),...next.map(({kind,templateId,versionId})=>({kind,templateId,versionId}))]);setDirty(true)
            }
            return <GridRow key={spec.kind}><GridCell><span className={styles.name} title={spec.label}>{spec.label}</span></GridCell><GridCell>
              <EntityPickerField label={`${spec.label}を選ぶ`} title={`統括の${spec.label}を選ぶ`} noun={spec.label}
                placeholder={choices.length ? '未設定' : 'まだありません'} items={items} disabled={busy || role===null} lockedReason={lock}
                state={choices.length ? undefined : <ListState kind="empty" title="まだありません" description="統括のカタログに登録されると、ここから選べます。" emptyPreset="readonly" />}
                {...(spec.multiple ? {multiple:true as const,value:values,onChange:update,allowEmpty:true} : {value:values[0] ?? null,onChange:(id:string)=>update(id?[id]:[]),clearable:true})} />
            </GridCell></GridRow>
          })}
        </GridTable>
        {!catalogMode ? <Notice tone="info">保存すると、これから作るアカウントは選んだ物だけを使います。今のお店の内容は変わりません。</Notice> : null}
      </>}
    </PageContent>
    <Dialog open={viewLegacy} title="現在の初期セット" onCancel={()=>setViewLegacy(false)}>
      {legacy.length ? <ul>{legacy.map(item=><li key={item.key}>{item.name}</li>)}</ul> : <p>統括の保存済みの組はありません。現在は musubo の標準を使います。</p>}
    </Dialog>
    <ConfirmDialog open={confirm!==null} title={confirm==='save' ? '初期セットを保存しますか？' : '入力を破棄しますか？'}
      description={confirm==='save' ? selected.length===0 ? '何も入れない組として保存します。既存のお店の内容は変わりません。' : '従来の初期セットを、選んだカタログの組へ切り替えます。以前の組は履歴に残り、既存のお店の内容は変わりません。' : '保存していない選択があります。別のスタイルへ移ると、この変更は残りません。'}
      confirmLabel={confirm==='save' ? '保存する' : '破棄して移る'} busy={busy} error={error || undefined}
      onCancel={()=>setConfirm(null)} onConfirm={()=>{if(confirm==='save')void save();else if(confirm){setActive(confirm);populate(sets ?? [],confirm);setConfirm(null)}}}>
      {confirm==='save' && !catalogMode && legacy.length ? <ul>{legacy.map(item=><li key={item.key}>{item.name}</li>)}</ul> : null}
    </ConfirmDialog>
  </SettingsPage>
}
