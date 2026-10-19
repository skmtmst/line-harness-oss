'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Pencil, Plus, Send } from 'lucide-react'
import Button from '@/components/shared/button'
import CategoryPanel from '@/components/shared/category-panel'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { Tabs } from '@/components/shared/tabs'
import { hqTemplateTabsForStarterSets } from '@/v8/hq-templates/public/store-list/index'
import { RowMenu } from '@/components/shared/row-actions'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ListPage } from '@/components/templates'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import type { AccountStyle, StyleTemplateSample } from '@line-crm/shared'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import Toggle from '@/components/shared/toggle'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import EntitySelect from '@/components/shared/entity-select'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { readSaveFieldErrors } from '@/lib/api/helpers/field-errors'
import { useAccount } from '@/contexts/account-context'
import { hqStyleApi, type StarterSetItem, type StyleStarterSet } from '@/lib/api/helpers/styles'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifySaved } from '@/components/shared/toast'
import { STYLE_CHOICES, styleLabel } from '@/v8/onboarding/public/model/index'
import styles from './starter-sets.module.css'

/*
 * 統括の「スタイルの初期セット」（★V8 修正案の列 VHp7p `J6647`。決まり ）。
 *
 * スタイルごとに、新しいアカウントで自動で入れる物（リッチメニュー・テンプレート・オートメーション・
 * 予約メニュー・ダッシュボードの型）を束ねて見せる。自動で送る物は「止めた状態で入る」。
 * 読みは組4の `GET /api/hq/style-starter-sets`。作る・直す・配る・標準に戻す・自動で入れるの切り替えは
 * 口が入るまで準備中の窓。
 */

const KIND_ROWS: ReadonlyArray<{ kind: StarterSetItem['kind']; label: string; how: { text: string; tone: 'neutral' | 'warning' } }> = [
  { kind: 'rich_menu', label: 'リッチメニュー', how: { text: '見本の札つきで入る', tone: 'neutral' } },
  { kind: 'template', label: 'テンプレート', how: { text: '見本の札つきで入る', tone: 'neutral' } },
  { kind: 'automation', label: 'オートメーション', how: { text: '止めた状態で入る', tone: 'warning' } },
  { kind: 'booking_menu', label: '予約メニュー', how: { text: '見本の札つきで入る', tone: 'neutral' } },
  { kind: 'dashboard', label: 'ダッシュボードの型', how: { text: 'そのまま入る', tone: 'neutral' } },
]

function nameOf(list: StarterSetItem[], kind: StarterSetItem['kind']): { main: string; sub?: string } {
  if (kind === 'rich_menu') return { main: list[0].name, sub: list[0].buttons ? `${list[0].buttons.length}つのボタン` : undefined }
  if (kind === 'automation') return { main: list.length > 1 ? `${list[0].name} ほか ${list.length}件` : list[0].name, sub: 'LINE に自動で送る物' }
  if (kind === 'booking_menu' && list.length <= 3) return { main: list.map((item) => item.name).join('・') }
  return { main: list.length > 1 ? `${list[0].name} ほか ${list.length}件` : list[0].name }
}

function shortDate(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, '0')}`
}

export default function HqStarterSetsV8() {
  usePageTitle('スタイルの初期セット')
  const role = useStaffRole()
  const canEdit = role === null || canManageRole(role)
  const preparing = usePreparingDialog()
  const [sets, setSets] = useState<StyleStarterSet[] | null>(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState<AccountStyle>('restaurant')
  const [removing, setRemoving] = useState<StarterSetItem['kind'] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  /* テンプレートの見本（ 追記4・組4 hqStyleApi.templateSamples）。業種を替えたら読み直す。 */
  const [samples, setSamples] = useState<StyleTemplateSample[] | null>(null)
  const [samplesError, setSamplesError] = useState(false)
  const [sampleOpen, setSampleOpen] = useState<StyleTemplateSample | null>(null)
  const [samplesTick, setSamplesTick] = useState(0)
  /* 配る前の確かめ（f7x1BZ）：配る先と、店が直した物の扱い。 */
  const [distribute, setDistribute] = useState<{ target: 'style' | 'pick'; accounts: string[]; mode: 'alias' | 'overwrite' } | null>(null)
  const { accounts } = useAccount()

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await hqStyleApi.listStarterSets()
      if (!res.success) throw new Error('list failed')
      setSets(res.data)
    } catch (caught) {
      setError(describeApiFailure(caught, '読み込み', { scope: 'hq' }))
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let cancelled = false
    setSamples(null)
    setSamplesError(false)
    void hqStyleApi.templateSamples(active).then((res) => { if (!cancelled && res.success) setSamples(res.data.items) }).catch(() => { if (!cancelled) setSamplesError(true) })
    return () => { cancelled = true }
  }, [active, samplesTick])

  /* 使っているアカウントの数は口が返さない（API-CONTRACT-4 §10）。数は出さない。 */
  /* 左の数＝そのスタイルを選んでいる店の数（口の accountCount。統括の初期セットがある業種だけ）。 */
  const rows = STYLE_CHOICES.map(({ value: style }) => ({ id: style, label: styleLabel(style), count: sets?.find((item) => item.style === style)?.accountCount ?? null }))
  const set = sets?.find((item) => item.style === active) ?? null
  const groups = useMemo(() => KIND_ROWS.map((row) => ({ ...row, items: (set?.definition.items ?? []).filter((item) => item.kind === row.kind) })).filter((row) => row.items.length > 0), [set])
  const label = styleLabel(active)

  /* 新しいアカウントで自動で入れるの切り替え（今の中身・名前・版と一緒に保存する）。 */
  const saveErrors = useSaveFormErrors()
  const saveAutoInsert = async (next: boolean) => {
    if (!set) return
    setSaving(true)
    try {
      const res = await hqStyleApi.saveStarterSet(set.style, { expectedVersion: set.version, name: set.name, definition: set.definition, autoInsert: next })
      if (!res.success) throw new Error('save failed')
      notifySaved(next ? '新しいアカウントに自動で入れます' : '新しいアカウントには自動で入れません')
      await load()
    } catch (caught) {
      if (!saveErrors.capture(caught)) setError(describeApiFailure(caught, '保存', { scope: 'hq' }))
    } finally {
      setSaving(false)
    }
  }

  /* 統括の初期セットから種類ごと外す（版つきで保存。ぶつかったら読み直してもらう）。 */
  const removeKind = async () => {
    if (!set || !removing) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await hqStyleApi.saveStarterSet(set.style, { expectedVersion: set.version, name: set.name, definition: { items: set.definition.items.filter((item) => item.kind !== removing) } })
      if (!res.success) throw new Error('save failed')
      notifySaved('初期セットから外しました')
      setRemoving(null)
      await load()
    } catch (caught) {
      // 入力検査の理由（400/422）は、窓の中にそのまま出す。ほかは共通の失敗文。
      saveErrors.capture(caught)
      setSaveError(Object.values(readSaveFieldErrors(caught))[0] ?? describeApiFailure(caught, '保存', { scope: 'hq' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SaveErrorScope errors={saveErrors}><ListPage
      boardId="J6647"
      title="スタイルの初期セット"
      tabs={<Tabs size="compact" label="テンプレートの種類" items={hqTemplateTabsForStarterSets()} />}
      help="スタイルごとに、新しいアカウントへ最初から入れる物です。入った物には「見本」の札が付き、店で直せます。"
      actions={canEdit ? <>
        <Button onClick={() => preparing.open('標準に戻す')}>標準に戻す</Button>
        <Button variant="primary" onClick={() => preparing.open('初期セットを作る')}><Plus aria-hidden="true" className={styles.buttonIcon} />初期セットを作る</Button>
      </> : null}
      folders={<CategoryPanel heading="スタイル" showHeading rows={rows} activeId={active} onSelect={(id) => setActive(id as AccountStyle)} />}
      folderNav={{ label: 'スタイル', rows, activeId: active, onSelect: (id) => setActive(id as AccountStyle) }}
    >
      <div className={styles.body}>
        {error ? <Notice tone="danger" action={<Button onClick={() => void load()}>もう一度試す</Button>}>{error}</Notice> : null}
        <div className={styles.head}>
          <h3 className={styles.title}>{`${label}の初期セット`}</h3>
          {set ? <StatusBadge tone="info" dot>{`${set.accountCount} アカウントで使用中`}</StatusBadge> : <StatusBadge tone="neutral" dot>musubo の標準</StatusBadge>}
          <span className={styles.spacer} />
          {canEdit ? <>
            <Button onClick={() => preparing.open('初期セットの中身を直す')}><Pencil aria-hidden="true" className={styles.buttonIcon} />中身を直す</Button>
            {set ? <Button variant="primary" onClick={() => setDistribute({ target: 'style', accounts: [], mode: 'alias' })}><Send aria-hidden="true" className={styles.buttonIcon} />{`使っている ${set.accountCount} アカウントへ配る`}</Button> : null}
          </> : null}
        </div>
        <div className={styles.auto}>
          <span className={styles.autoText}>
            <span className={styles.autoTitle}>新しいアカウントで、このスタイルを選んだときに自動で入れる</span>
            <span className={styles.autoNote}>入った物には「見本」の札が付き、店で直せます</span>
          </span>
          {/* 新しいアカウントへは必ず入る（口に切り替えが無い）。押せないスイッチは置かず、状態の札で出す。 */}
          {set && canEdit
            ? <SaveErrorField names={['autoInsert', 'auto_insert']}><Toggle label="新しいアカウントで自動で入れる" checked={set.autoInsert} disabled={saving} onChange={(next) => void saveAutoInsert(next)} /></SaveErrorField>
            : <StatusBadge tone={set?.autoInsert === false ? 'neutral' : 'success'} dot>{set?.autoInsert === false ? '入れない' : '自動で入れる'}</StatusBadge>}
        </div>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>入る物</h3>
          <HelpTip label="入る物の説明">新しいアカウントでこのスタイルを選んだときに入る物です。自動で送る物は止めた状態で入ります。</HelpTip>
        </div>
        {sets === null ? (error ? null : <ListState kind="loading" title="読み込んでいます…" />) : groups.length === 0 ? (
          <ListState kind="empty" title={`${label}の初期セットはまだありません`} description="［初期セットを作る］から作れます。" emptyPreset="readonly" />
        ) : (
          <div className={styles.table}>
            <GridTable label="入る物" design={{ columns: 'var(--hss-col-kind) minmax(0, 1fr) var(--hss-col-how) var(--hss-col-date) var(--hss-col-menu)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', rowHeight: 'var(--hss-row-h)', fontSize: 'var(--text-body)' }}>
              <GridHeadRow>
                <GridCell role="columnheader">種類</GridCell>
                <GridCell role="columnheader">名前</GridCell>
                <GridCell role="columnheader">入り方</GridCell>
                <GridCell role="columnheader">最後に直した</GridCell>
                <GridCell role="columnheader">操作</GridCell>
              </GridHeadRow>
              {groups.map((group) => {
                const name = nameOf(group.items, group.kind)
                return (
                  <GridRow key={group.kind} className={styles.row}>
                    <GridCell>{group.label}</GridCell>
                    <GridCell className={styles.name}>
                      <button type="button" className={styles.nameButton} title={name.main} onClick={() => preparing.open(`${group.label}の中身`)}>{name.main}</button>
                      {name.sub ? <span className={styles.sub}>{name.sub}</span> : null}
                    </GridCell>
                    <GridCell><StatusBadge tone={group.how.tone} dot>{group.how.text}</StatusBadge></GridCell>
                    {/* 口は初期セット全体の更新日時を返す（種類ごとではない）。直した人は ID なので名前は出さない。 */}
                    <GridCell><span className={styles.date}>{set ? shortDate(set.updatedAt) : '—'}</span></GridCell>
                    <GridCell>{canEdit ? <RowMenu appearance="box" size="row" label={`${group.label}の操作`} items={[
                      { id: 'edit', label: '中身を直す', onSelect: () => preparing.open(`${group.label}の中身を直す`) },
                      ...(set ? [{ id: 'remove', label: '初期セットから外す', tone: 'danger' as const, onSelect: () => { setSaveError(''); setRemoving(group.kind) } }] : []),
                    ]} /> : null}</GridCell>
                  </GridRow>
                )
              })}
            </GridTable>
          </div>
        )}
        {groups.some((group) => group.kind === 'automation') && <Notice tone="info" icon={<Info aria-hidden="true" />}>自動で送る物は、店が一度確かめて［動かす］を押すまで送りません。直したあとは［使っているアカウントへ配る］で、配る先と上書きのしかたを確かめてから配ります。</Notice>}
        <section className={styles.samples} aria-labelledby="hss-samples">
          <div className={styles.sectionHead}>
            <h3 id="hss-samples" className={styles.sectionTitle}>テンプレートの見本</h3>
            <HelpTip label="テンプレートの見本の説明">この業種で新しいアカウントに「【見本】」の名前で入るメッセージです。差し込み（名前・日時・店名・URL）は送る前に入れます。</HelpTip>
            <span className={styles.spacer} />
            {samples ? <span className={styles.sampleCount}>{`${samples.length}件`}</span> : null}
          </div>
          {samplesError ? <ListState kind="error" title="見本を読み込めませんでした" onRetry={() => setSamplesTick((value) => value + 1)} /> : samples === null ? <ListState kind="loading" title="読み込んでいます…" /> : (
            <div className={styles.table}>
              <GridTable label="テンプレートの見本" design={{ columns: 'minmax(0, 1fr) var(--hss-col-kind) var(--hss-col-kind) var(--hss-col-open)', gap: 'var(--polish-space-card)', rowPadding: '0 var(--polish-space-section)', fontSize: 'var(--text-body)' }}>
                <GridHeadRow>
                  <GridCell role="columnheader">名前</GridCell>
                  <GridCell role="columnheader">種類</GridCell>
                  <GridCell role="columnheader">差し込み</GridCell>
                  <GridCell role="columnheader">操作</GridCell>
                </GridHeadRow>
                {samples.map((sample) => (
                  <GridRow key={sample.key} className={styles.sampleRow}>
                    <GridCell className={styles.name}><span className={styles.sampleName} title={sample.name}>{sample.name}</span></GridCell>
                    <GridCell>{sample.category === 'common' ? '共通' : styleLabel(sample.category)}</GridCell>
                    <GridCell>{sample.placeholders.length ? `${sample.placeholders.length}つ` : 'なし'}</GridCell>
                    <GridCell><Button size="compact" onClick={() => setSampleOpen(sample)}>中身を見る</Button></GridCell>
                  </GridRow>
                ))}
              </GridTable>
            </div>
          )}
        </section>
      </div>
      <Dialog open={sampleOpen !== null} title={sampleOpen?.name ?? ''} description={sampleOpen?.preparation} size="medium" onCancel={() => setSampleOpen(null)}>
        {sampleOpen ? (
          <div className={styles.sampleBody}>
            <p className={styles.sampleText}>{sampleOpen.text}</p>
            {sampleOpen.placeholders.length ? (
              <ul className={styles.placeholders} aria-label="差し込み">
                {sampleOpen.placeholders.map((item) => <li key={item.token}><StatusBadge tone={item.requiresConfiguration ? 'warning' : 'neutral'} dot>{item.label}</StatusBadge></li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Dialog>
        {distribute && set ? (
        <Dialog
          open
          title={`${label}の初期セットを配りますか？`}
          description="直した見本を、このスタイルを使っているアカウントに入れます"
          size="small"
          designNode="f7x1BZ"
          onCancel={() => setDistribute(null)}
          footerDivider
          footer={(
            <DialogActions leadingAction={<span className={styles.footLead}>配った記録が残ります</span>}>
              <Button onClick={() => setDistribute(null)}>やめる</Button>
              <Button variant="primary" disabled={distribute.target === 'pick' && distribute.accounts.length === 0} onClick={() => { setDistribute(null); preparing.open('初期セットを配る') }}>
                <Send aria-hidden="true" className={styles.buttonIcon} />{`${distribute.target === 'style' ? set.accountCount : distribute.accounts.length} アカウントへ配る`}
              </Button>
            </DialogActions>
          )}
        >
          <div className={styles.distribute}>
            <RadioCardGroup legend="配る先" legendVisible>
              <RadioCard variant="row" name="hss-target" value="style" checked={distribute.target === 'style'} onChange={() => setDistribute({ ...distribute, target: 'style' })} title={`このスタイルを使っている ${set.accountCount} アカウント`} />
              <RadioCard variant="row" name="hss-target" value="pick" checked={distribute.target === 'pick'} onChange={() => setDistribute({ ...distribute, target: 'pick' })} title="アカウントを選ぶ" />
            </RadioCardGroup>
            {distribute.target === 'pick' ? (
              <EntitySelect aria-label="配るアカウント" noun="アカウント" placeholder="アカウントを選ぶ" values={distribute.accounts} onChange={(values) => setDistribute({ ...distribute, accounts: values })} options={accounts.map((account) => ({ value: account.id, label: account.name }))} />
            ) : null}
            <RadioCardGroup legend="店が直した物があるとき" legendVisible>
              <RadioCard variant="row" name="hss-mode" value="alias" checked={distribute.mode === 'alias'} onChange={() => setDistribute({ ...distribute, mode: 'alias' })} title="上書きせず、新しく作る（おすすめ）" />
              <RadioCard variant="row" name="hss-mode" value="overwrite" checked={distribute.mode === 'overwrite'} onChange={() => setDistribute({ ...distribute, mode: 'overwrite' })} title="本部の見本で上書きする" />
            </RadioCardGroup>
            <dl className={styles.facts}>
              <dt>入る物</dt><dd>{KIND_ROWS.filter((row) => row.kind !== 'dashboard').map((row) => [row.label, set.definition.items.filter((item) => item.kind === row.kind).length] as const).filter(([, n]) => n > 0).map(([name, n]) => `${name} ${n}`).join('・')}</dd>
              <dt>店が直した物</dt><dd>{distribute.mode === 'alias' ? '配るときに確かめ、新しく作ります' : '配るときに確かめ、本部の見本で上書きします'}</dd>
              <dt>自動で送る物</dt><dd>止めた状態で入ります。店が［動かす］を押すまで送りません</dd>
            </dl>
          </div>
        </Dialog>
      ) : null}
      {preparing.dialog}
      <ConfirmDialog
        open={removing !== null}
        title="初期セットから外しますか？"
        description={`これから新しく作るアカウントには「${KIND_ROWS.find((row) => row.kind === removing)?.label ?? ''}」が入らなくなります。今あるアカウントの中身は変わりません。`}
        confirmLabel="外す"
        destructive
        busy={saving}
        busyLabel="外しています…"
        error={saveError}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void removeKind()}
      />
    </ListPage></SaveErrorScope>
  )
}
