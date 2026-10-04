'use client'

/*
 * ★V8-B マイペット（Pencil「★V8-B 画面の地図」専用機能の組：
 * 一覧 `wTIej`、一覧1152 `t2SMXX`、ごはんの目安 `h7A2F`、
 * ペットの情報を直す `eLjeQ`、状態の板 `dzx5D`）。
 *
 * v7（page.tsx 内の PetsInner と pets-tab / feeding-tab / pet-editor）
 * とは別の部品として持ち、data-theme="v8" のときだけこちらが出る。
 * データの口（pets・feeding・saveFeeding・updatePet・CSV）は同じ。
 * 違いは置き場と見せ方だけ——
 * ・数の帯は1枚の白い板に区切り線で4つ（離したカードにしない）。
 * ・行末の操作は「…」に集約（ペットの情報を直す・飼い主を開く）。
 * ・1152 では 年齢・避妊去勢・運動量 を隠す（t2SMXX。直す窓で見られる）。
 * ・ごはんの目安は左に節のカード2枚＋おやつの上限、右に計算のカード。
 * ・ペットの情報を直すは真ん中の小窓（eLjeQ）。版つき保存・競合はそのまま。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Calculator, History, PawPrint, Sparkles } from 'lucide-react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import { describeApiFailure } from '@/components/shared/api-error-message'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import PageSizeSelect from '@/components/ui/page-size-select'
import ListRange from '@/components/ui/list-range'
import { RowActions } from '@/components/shared/row-actions'
import type { ActionMenuItem } from '@/components/shared/action-menu'
import StickyBar from '@/components/shared/sticky-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Tabs } from '@/components/shared/tabs'
import { TextField } from '@/components/shared/text-field'
import Select from '@/components/shared/select'
import { ApiError, api } from '@/lib/api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { formatNumber } from '@/lib/format'
import { csvCell } from '@/lib/presentation'
import {
  headCountLabel,
  nenPetsApi,
  petAnimalTypeLabel,
  type NenPetListData,
  type NenPetRow,
  type NenPetSort,
  type NenPetWeightFilter,
} from '@/lib/nen-pets-api'
import { nenRanksApi, type NenFeedingData, type NenFeedingKind } from '@/lib/nen-ranks-api'
import { birthdayDraft, normalizeBirthdayInput } from './pet-editor'
import type { PetTab } from './page'
import styles from './pets-v8.module.css'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

export type PetsV8Query = { q: string; species: string; product: string; weight: NenPetWeightFilter; sort: NenPetSort }

const NEUTERED_LABEL = { yes: '済み', no: 'していない', unknown: 'わからない' } as const

/** 板ごとの data-design-node（タブで切り替える外枠の印）。 */
const BOARD_NODE: Record<PetTab, string> = {
  pets: 'wTIej',
  feeding: 'h7A2F',
}

/* #999 DEEP-25: CSVの1マス整形は共通の csvCell。page.tsx（v7）と同じ中身。 */
function petsToCsv(items: NenPetRow[]): string {
  const header = ['ペット名', '呼び名', '性別', '種類', '品種', '誕生日', '年齢', '体重(kg)', '避妊去勢', '運動量', '主食', '1日の目安(g)', '1日の必要カロリー(kcal)', '然の鹿肉の目安(g)', '体重の更新日', '飼い主', 'EC会員ID']
  const lines = items.map((p) => [
    p.name, p.callName, p.gender === 'male' ? '男の子' : p.gender === 'female' ? '女の子' : '未回答', petAnimalTypeLabel(p.animalType), p.breed, p.birthday ?? '', p.ageLabel, p.weightKg ?? '', NEUTERED_LABEL[p.neutered], p.activityLabel,
    p.productName ?? '', p.feeding?.dailyGrams ?? '', p.feeding?.dailyKcal ?? '', p.feeding?.venisonGrams ?? '', p.weightUpdatedAt.slice(0, 10), p.owner.name, p.owner.customerId ?? '',
  ].map(csvCell).join(','))
  return `\uFEFF${[header.join(','), ...lines].join('\n')}`
}

/**
 * マイペットの V8 画面。外枠（見出し・タブ・数の帯）は登録ペットと
 * ごはんの目安で同じ。数の帯はごはんの目安でも出す（描いた板どおり）。
 */
export default function PetsPageV8({
  accountId,
  tab,
  onChangeTab,
}: {
  accountId: string | null
  tab: PetTab
  onChangeTab: (next: PetTab) => void
}) {
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [kpis, setKpis] = useState<NenPetListData['kpis'] | null>(null)
  const [kpisLoading, setKpisLoading] = useState(true)

  // 数の帯は一覧の取得に付いてくる。タブをまたいで使い回す。
  useEffect(() => {
    if (!accountId) { setKpis(null); setKpisLoading(false); return }
    let active = true
    setKpisLoading(true)
    void nenPetsApi.pets(accountId, { pageSize: 1 }).then((res) => {
      if (!active || !res.success) return
      setKpis(res.data.kpis)
      setTotal(res.data.kpis.total)
      setKpisLoading(false)
    }).catch(() => {
      if (active) setKpisLoading(false)
    })
    return () => { active = false }
  }, [accountId])

  return (
    <div data-design-node={BOARD_NODE[tab]} className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>マイペット</h1>
          <p className={styles.headDesc}>お客さまがマイページで登録したペットです。体重と主食から、1日のごはんの目安を出します。</p>
        </div>
      </div>
      <div data-design="Tabs" data-design-node="pets-tabs-v8">
        <Tabs
          items={[
            { label: '登録ペット', count: total, current: tab === 'pets', onClick: () => onChangeTab('pets') },
            { label: 'ごはんの目安', current: tab === 'feeding', onClick: () => onChangeTab('feeding') },
          ]}
        />
      </div>

      <PetsKpiBand kpis={kpis} loading={kpisLoading} />

      {!accountId ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選んでください"
          description="上のバーから、ペットを見るLINEアカウントを選びます。"
        />
      ) : tab === 'feeding' ? (
        <FeedingV8 accountId={accountId} />
      ) : (
        <PetsListV8
          accountId={accountId}
          onTotal={(next, nextKpis) => { setTotal(next); setKpis(nextKpis) }}
        />
      )}
    </div>
  )
}

/**
 * 数の帯。1枚の白い板を区切り線で4つに分ける（★V8 の決まり：
 * 数の帯はカードを離して並べず、白い板の左右いっぱいに置く）。
 */
function PetsKpiBand({
  kpis,
  loading,
}: {
  kpis: NenPetListData['kpis'] | null
  loading: boolean
}) {
  const pending = loading || !kpis
  const cell = (
    icon: React.ReactNode,
    label: string,
    help: string,
    value: number | null,
    sub: string,
  ) => (
    <li className={styles.kpiCell} key={label}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiIcon} aria-hidden="true">{icon}</span>
        <span className={styles.kpiLabel}>{label}</span>
        <button type="button" className={styles.kpiHelp} title={help} aria-label={`${label}：${help}`}>…</button>
      </div>
      <p className={styles.kpiValue}>{value === null ? '—' : <>{formatNumber(value)}<span className={styles.kpiUnit}>匹</span></>}</p>
      <p className={styles.kpiSub}>{sub}</p>
    </li>
  )

  return (
    <ul className={styles.kpiBand} aria-label="ペットの数の帯">
      {cell(<PawPrint size={14} />, '登録ペット', 'お客さまがマイページで登録したペットの数です', pending ? null : kpis!.total, pending ? ' ' : `犬 ${kpis!.dogs}・猫 ${kpis!.cats}・その他 ${Math.max(0, kpis!.total - kpis!.dogs - kpis!.cats)}`)}
      {cell(<Sparkles size={14} />, '今月の新規', '1日から今日までに登録されたペットです', pending ? null : kpis!.newThisMonth, '1日から今日まで')}
      {cell(<Calculator size={14} />, '目安を出せる', '体重と主食が揃っているペットです', pending ? null : kpis!.computable, '犬・猫で体重と主食がそろっている')}
      {cell(<History size={14} />, '体重が古い', '体重が90日更新されていないペットです', pending ? null : kpis!.staleWeight, '90日 更新なし')}
    </ul>
  )
}

/**
 * 登録ペットの一覧（wTIej）。列は今の作りと同じ10列。
 * 行末の操作は「…」に集約（ペットの情報を直す・飼い主を開く）。
 */
function PetsListV8({
  accountId,
  onTotal,
}: {
  accountId: string
  onTotal: (total: number | undefined, kpis: NenPetListData['kpis']) => void
}) {
  const [status, setStatus] = useState<ListStatus>('loading')
  const [data, setData] = useState<NenPetListData | null>(null)
  const [query, setQuery] = useState<PetsV8Query>({ q: '', species: '', product: '', weight: '', sort: 'updated_desc' })
  const [draft, setDraft] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editing, setEditing] = useState<NenPetRow | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  // 編集口（PUT）は owner/admin だけ。staff は一覧の閲覧まで。
  const [canEdit, setCanEdit] = useState(false)
  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      setCanEdit(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await nenPetsApi.pets(accountId, { ...query, page, pageSize })
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      onTotal(res.data.kpis.total, res.data.kpis)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, query, page, pageSize, onTotal])

  useEffect(() => {
    void load()
  }, [load])

  const change = (patch: Partial<PetsV8Query>) => { setQuery({ ...query, ...patch }); setPage(1) }
  const filtering = query.q !== '' || query.species !== '' || query.product !== '' || query.weight !== ''
  const clearFilters = () => { setQuery({ q: '', species: '', product: '', weight: '', sort: 'updated_desc' }); setDraft(''); setPage(1) }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError(false)
    try {
      const res = await nenPetsApi.pets(accountId, { ...query, pageSize: 'all' })
      if (!res.success) throw new Error(res.error)
      const blob = new Blob([petsToCsv(res.data.items)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nen-pets-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className={styles.tools} data-design="ListControls" data-design-node="pets-controls-v8">
        <form
          className={styles.searchGrow}
          onSubmit={(event) => { event.preventDefault(); change({ q: draft.trim() }) }}
        >
          <TextField
            aria-label="ペットを検索"
            placeholder="ペット名・飼い主で探す"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        <Select
          aria-label="種別で絞り込む"
          value={query.species}
          onChange={(value) => change({ species: value })}
          options={[{ value: '', label: '種別：すべて' }, { value: 'dog', label: '種別：犬' }, { value: 'cat', label: '種別：猫' }, { value: 'other', label: '種別：その他' }]}
        />
        <Select
          aria-label="主食で絞り込む"
          value={query.product}
          onChange={(value) => change({ product: value })}
          options={[
            { value: '', label: '主食：すべて' },
            ...(data?.products ?? []).map((p) => ({ value: p.id, label: `主食：${p.name}` })),
            { value: 'none', label: '主食：未設定' },
          ]}
        />
        <Select
          aria-label="体重の更新で絞り込む"
          value={query.weight}
          onChange={(value) => change({ weight: value === 'stale' || value === 'fresh' ? value : '' })}
          options={[{ value: '', label: '体重更新：すべて' }, { value: 'fresh', label: '体重更新：90日以内' }, { value: 'stale', label: '体重更新：90日以上前' }]}
        />
        <Select
          aria-label="並び順"
          value={query.sort}
          onChange={(value) => change({ sort: value as NenPetSort })}
          options={[
            { value: 'updated_desc', label: '並び：更新が新しい順' },
            { value: 'name', label: '並び：名前順' },
            { value: 'weight_desc', label: '並び：体重が重い順' },
            { value: 'age_desc', label: '並び：年齢が高い順' },
          ]}
        />
        <span className={styles.toolsTail}>
          <span className={styles.rangeLabel}>{data ? headCountLabel(data.total, data.page, data.pageSize) : '—'}</span>
          <PageSizeSelect
            value={pageSize}
            options={[10, 20, 50]}
            onChange={(value) => { setPageSize(value); setPage(1) }}
          />
          <Button type="button" variant="secondary" onClick={() => void exportCsv()} disabled={exporting} busy={exporting} busyLabel="書き出しています…">CSVで書き出す</Button>
        </span>
      </div>

      <div data-design="Note" data-design-node="pets-note-v8">
        <NoteBar tone="info">
          体重が90日更新されていないペットは、マイページで更新をお願いできます（行の「…」→マイページで更新を促す）。
        </NoteBar>
      </div>

      {exportError ? (
        <NoteBar tone="warn">CSVを書き出せませんでした。通信の状態を確認して、もう一度お試しください。</NoteBar>
      ) : null}

      <section data-design="Table" data-design-node="pets-table-v8">
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="ペットを読み込んでいます" />
        ) : status === 'forbidden' ? (
          <ListState kind="forbidden" />
        ) : status === 'error' ? (
          <ListState kind="error" title="ペットを読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" action={<Button variant="secondary" onClick={() => void load()}>もう一度試す</Button>} />
        ) : data && data.items.length === 0 ? (
          filtering ? (
            <ListState
              kind="empty"
              title="条件に合うペットはいません"
              description="検索や絞り込みを外すと、すべて出ます。"
              action={<Button variant="secondary" onClick={clearFilters}>条件を外す</Button>}
            />
          ) : (
            <ListState kind="empty" emptyPreset="readonly" title="まだペットがいません" description="お客さまがマイページでペットを登録すると、ここに並びます。" />
          )
        ) : data ? (
          <>
            <div className={styles.tableWrap}>
              <DataTable className="@container">
                <thead>
                  <TableHeadRow>
                    <Th>ペット</Th>
                    <Th>飼い主</Th>
                    <Th className={styles.colAge}>年齢</Th>
                    <Th align="right">体重</Th>
                    <Th>今日の目安</Th>
                    <Th className={styles.colNeutered}>避妊去勢</Th>
                    <Th className={styles.colActivity}>運動量</Th>
                    <Th>主食</Th>
                    <Th>体重の更新</Th>
                    <Th className="w-14" align="right"><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {data.items.map((pet) => (
                    <PetRowV8 key={pet.id} pet={pet} canEdit={canEdit} onEdit={() => setEditing(pet)} />
                  ))}
                </tbody>
              </DataTable>
            </div>
            <div className={styles.listFoot}>
              <ListRange
                total={data.total}
                first={data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}
                last={Math.min(data.total, data.page * data.pageSize)}
              />
              {data.total > data.pageSize ? (
                <Pagination
                  page={data.page}
                  pageCount={Math.max(1, Math.ceil(data.total / data.pageSize))}
                  onPageChange={setPage}
                />
              ) : null}
            </div>
            <p className={styles.listHint}>行の「…」から ペットの情報を直す・飼い主を開く。</p>
          </>
        ) : null}
      </section>
      {editing ? (
        <PetEditorV8 accountId={accountId} pet={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      ) : null}
    </>
  )
}

function PetRowV8({ pet, canEdit, onEdit }: { pet: NenPetRow; canEdit: boolean; onEdit: () => void }) {
  const initial = (pet.name || '?').slice(0, 1)
  const kind = petAnimalTypeLabel(pet.animalType)
  const name = pet.callName || pet.name || '（名前なし）'
  const menuItems: ActionMenuItem[] = [
    ...(canEdit ? [{ id: 'edit', label: 'ペットの情報を直す', onSelect: onEdit }] : []),
    { id: 'owner', label: '飼い主を開く', external: true, onSelect: () => { window.location.href = `/friends/detail?id=${encodeURIComponent(pet.owner.friendId)}` } },
  ]
  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-3">
          {pet.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- お客様がマイページで登録した写真
            <img src={pet.imageUrl} alt="" className={styles.petFace} />
          ) : (
            <span aria-hidden="true" className={styles.petFace}>{initial}</span>
          )}
          <span className="min-w-0">
            <span className={styles.petName} title={pet.callName}>{name}</span>
            <span className={styles.petSub}>{pet.breed ? `${kind}・${pet.breed}` : kind}</span>
          </span>
        </span>
      </Td>
      <Td>
        <span className={styles.petName} title={pet.owner.name}>{pet.owner.name || '（名前なし）'}</span>
        <span className={styles.petSub}>{pet.owner.customerId ? `EC会員 ${pet.owner.customerId}` : 'EC未連携'}</span>
      </Td>
      <Td className={styles.colAge}><span className="text-label text-ink-secondary">{pet.ageLabel}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{pet.weightKg == null ? '—' : `${pet.weightKg}kg`}</span></Td>
      <Td>
        {pet.feeding?.dailyGrams != null ? (
          <>
            <span className="block text-label font-semibold tabular-nums text-ink">{pet.feeding.dailyGrams}g／日</span>
            <span className="block text-micro text-ink-faint">{`約${pet.feeding.dailyKcal}kcal・鹿肉 ${pet.feeding.venisonGrams ?? 0}g`}</span>
          </>
        ) : pet.feeding ? (
          <>
            <span className="block text-label text-ink-secondary">—</span>
            <span className="block text-micro text-ink-faint">{`約${pet.feeding.dailyKcal}kcal・主食が未設定`}</span>
          </>
        ) : (
          <>
            <span className="block text-label text-ink-secondary">—</span>
            {/* #999 DEEP-24: 犬・猫以外はNRC/FEDIAFの計算対象外。犬の式で出した数値を見せない。 */}
            <span className="block text-micro text-ink-faint">{pet.animalType === 'other' ? '犬・猫以外は目安の計算対象外' : pet.weightKg == null ? '体重が未登録' : '誕生日が未登録'}</span>
          </>
        )}
      </Td>
      <Td className={styles.colNeutered}><span className="block truncate text-label text-ink-secondary" title={NEUTERED_LABEL[pet.neutered]}>{NEUTERED_LABEL[pet.neutered]}</span></Td>
      <Td className={styles.colActivity}><span className="block truncate text-label text-ink-secondary" title={pet.activityLabel}>{pet.activityLabel}</span></Td>
      <Td><span className="block truncate text-label text-ink-secondary" title={pet.productName ?? '（未設定）'}>{pet.productName ?? '（未設定）'}</span></Td>
      <Td>
        {pet.weightStale ? (
          <Chip tone="warn">{pet.weightUpdatedAt.slice(5, 10).replace('-', '/')}</Chip>
        ) : (
          <span className="text-label text-ink-secondary">{pet.weightUpdatedAt.slice(5, 10).replace('-', '/')}</span>
        )}
      </Td>
      <Td align="right">
        <RowActions subjectName={name} menuItems={menuItems} />
      </Td>
    </Tr>
  )
}

/** 係数の説明（Worker `services/nen-feeding.ts` の ENERGY_FACTORS と同じ値）。 */
const FACTOR_ROWS: Array<{ label: string; dog: string; cat: string }> = [
  { label: '子犬・子猫（4か月未満）', dog: '3.0', cat: '2.5' },
  { label: '子犬・子猫（12か月未満）', dog: '2.0', cat: '2.5' },
  { label: '成犬・成猫（避妊去勢済み）', dog: '1.6', cat: '1.2' },
  { label: '成犬・成猫（していない）', dog: '1.8', cat: '1.4' },
  { label: 'シニア（避妊去勢済み）', dog: '1.4', cat: '1.1' },
  { label: 'シニア（していない）', dog: '1.6', cat: '1.3' },
  { label: '活動量「多め」「少なめ」', dog: '±0.2', cat: '±0.1' },
]

const MAX_PRODUCTS = 20

type FeedingDraft = { id: string | null; name: string; kcal: string; isDefault: boolean; kind: NenFeedingKind }

/**
 * ごはんの目安（h7A2F）。左に節のカード2枚＋おやつの上限、
 * 右に今日の目安の計算。保存は下の帯。離脱の番兵つき。
 */
function FeedingV8({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading')
  const [data, setData] = useState<NenFeedingData | null>(null)
  const [drafts, setDrafts] = useState<FeedingDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [treatLimit, setTreatLimit] = useState('10')
  const [dataAccountId, setDataAccountId] = useState(accountId)
  const generationRef = useRef(0)

  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy })

  // アカウントが切り替わったら表示と編集状態を捨てる（v7 feeding-tab と同じ）。
  if (dataAccountId !== accountId) {
    const hadUnsaved = dirty
    generationRef.current += 1
    setDataAccountId(accountId)
    setData(null)
    setDrafts([])
    setTreatLimit('10')
    setDirty(false)
    setError('')
    cancelLeave()
    setNotice(hadUnsaved ? 'LINEアカウントを切り替えたため、保存していない変更は破棄しました。' : '')
    setStatus('loading')
  }

  const fromData = (next: NenFeedingData): FeedingDraft[] =>
    next.products.map((p) => ({ id: p.id, name: p.name, kcal: String(p.kcalPer100g), isDefault: p.isDefault, kind: p.kind === 'nen' ? 'nen' : 'staple' }))

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setStatus('loading')
    try {
      const res = await nenRanksApi.feeding(accountId)
      if (!res.success) throw new Error(res.error)
      if (generationRef.current !== generation) return
      setData(res.data)
      setDrafts(fromData(res.data))
      setTreatLimit(String(res.data.treatLimitPercent ?? 10))
      setDirty(false)
      setStatus('ready')
    } catch (caught) {
      if (generationRef.current !== generation) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const update = (index: number, patch: Partial<FeedingDraft>) => {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setNotice('')
  }
  // 既定（主食）・目安に使う（然の商品）は、それぞれの種類で1つだけ。
  const setDefault = (index: number) => {
    setDrafts((current) => current.map((row, i) => (row.kind === current[index].kind ? { ...row, isDefault: i === index } : row)))
    setDirty(true)
  }
  const remove = (index: number) => {
    setDrafts((current) => {
      const removed = current[index]
      const next = current.filter((_, i) => i !== index)
      const first = next.findIndex((row) => row.kind === removed.kind)
      if (first >= 0 && !next.some((row) => row.kind === removed.kind && row.isDefault)) next[first] = { ...next[first], isDefault: true }
      return next
    })
    setDirty(true)
  }
  const add = (kind: NenFeedingKind) => {
    setDrafts((current) => [...current, { id: null, name: '', kcal: '', isDefault: !current.some((row) => row.kind === kind), kind }])
    setDirty(true)
  }
  const cancel = () => {
    if (data) { setDrafts(fromData(data)); setTreatLimit(String(data.treatLimitPercent ?? 10)) }
    setDirty(false)
    setError('')
  }

  const save = async () => {
    if (status !== 'ready' || dataAccountId !== accountId) return
    const generation = generationRef.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveFeeding(accountId, drafts.map((row) => ({
        id: row.id, name: row.name.trim(), kcalPer100g: Number(row.kcal.replace(/[,，]/g, '')), isDefault: row.isDefault, kind: row.kind,
      })), Number(treatLimit))
      if (!res.success) throw new Error(res.error)
      if (generationRef.current !== generation) return
      setData(res.data)
      setDrafts(fromData(res.data))
      setTreatLimit(String(res.data.treatLimitPercent ?? 10))
      setDirty(false)
      setNotice(res.data.refreshedPets
        ? `主食を保存し、登録済みのペット ${formatNumber(res.data.refreshedPets)}頭の目安を計算し直しました。`
        : '主食を保存しました。')
    } catch (caught) {
      setError(describeApiFailure(caught, '主食の保存', {
        forbidden: '主食を保存する権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' && !data) return <ListState kind="loading" title="主食のカロリー表を読み込んでいます" />
  if (status === 'forbidden') return <ListState kind="forbidden" />
  if (status === 'error') return <ListState kind="error" title="主食のカロリー表を読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
  if (!data) return <ListState kind="loading" title="主食のカロリー表を読み込んでいます" />

  return (
    <>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}

      <div className={styles.feedingGrid}>
        <div className={styles.feedingMain}>
          <FeedingTableV8
            kind="staple"
            title="主食（お客さまが選ぶ、ふだんのごはん）"
            description="一般的な種類だけ登録します。マイページの「いつもの主食」で選ばれ、1日の目安（g）はこの kcal で割ります。"
            defaultHead="既定の主食"
            defaultChip="既定"
            makeDefault="既定にする"
            addLabel="＋ 主食を追加する"
            drafts={drafts}
            onUpdate={update}
            onDefault={setDefault}
            onRemove={remove}
            onAdd={() => add('staple')}
            disabledAdd={drafts.length >= MAX_PRODUCTS}
          />
          <section className={styles.card} aria-label="然の商品">
            <h2 className={styles.cardTitle}>然の商品（おやつ・トッピング）</h2>
            <p className={styles.cardDesc}>然の商品名と100g あたりのカロリーを登録すると、マイページに「然の鹿肉の目安」が出ます</p>
            <FeedingTableV8
              kind="nen"
              bare
              title=""
              description=""
              defaultHead="目安に使う商品"
              defaultChip="目安に使う中"
              makeDefault="これを使う"
              addLabel="＋ 然の商品を追加する"
              drafts={drafts}
              onUpdate={update}
              onDefault={setDefault}
              onRemove={remove}
              onAdd={() => add('nen')}
              disabledAdd={drafts.length >= MAX_PRODUCTS}
            />
            <div className={styles.treatRow}>
              <label className={styles.fieldLabel}>
                おやつの上限（%）
                <span className={styles.treatInput}>
                  <TextField aria-label="おやつの上限（%）" inputMode="numeric" value={treatLimit} onChange={(event) => { setTreatLimit(event.target.value); setDirty(true); setNotice('') }} />
                </span>
              </label>
              <p className={styles.treatNote}>1日の必要カロリーのうち、おやつに回す割合</p>
            </div>
          </section>
        </div>

        <section className={styles.card} aria-label="今日の目安の計算">
          <h2 className={styles.cardTitle}>今日の目安の計算</h2>
          <p className={styles.cardDesc}>体重・年齢・避妊去勢・運動量から、公的な指針の式で計算します</p>
          <dl className={styles.formulaList}>
            <div>
              <dt className={styles.formulaLabel}>安静時エネルギー</dt>
              <dd className={styles.formulaValue}>70 × 体重(kg) の 0.75 乗</dd>
            </div>
            <div>
              <dt className={styles.formulaLabel}>1日の必要カロリー</dt>
              <dd className={styles.formulaValue}>安静時エネルギー × 係数</dd>
            </div>
            <div>
              <dt className={styles.formulaLabel}>1日の目安（g）</dt>
              <dd className={styles.formulaValue}>必要カロリー ÷ 主食の kcal/100g × 100</dd>
            </div>
            <div>
              <dt className={styles.formulaLabel}>然の鹿肉の目安（g）</dt>
              <dd className={styles.formulaValue}>必要カロリー × 上限% ÷ 然商品の kcal/100g × 100</dd>
            </div>
          </dl>
          <table className={styles.factorTable}>
            <thead>
              <tr><th scope="col">係数</th><th scope="col">犬</th><th scope="col">猫</th></tr>
            </thead>
            <tbody>
              {FACTOR_ROWS.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.dog}</td>
                  <td>{row.cat}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.factorNote}>犬・猫以外は計算しません</p>
        </section>
      </div>

      <StickyBar
        status={dirty ? '保存していない変更があります' : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={cancel} disabled={busy || !dirty || status !== 'ready'}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty || status !== 'ready' || dataAccountId !== accountId} busy={busy} busyLabel="保存しています…">保存する</Button>
          </>
        )}
      />

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="ごはんの目安への変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}

function FeedingTableV8({
  kind, bare, title, description, defaultHead, defaultChip, makeDefault, addLabel,
  drafts, onUpdate, onDefault, onRemove, onAdd, disabledAdd,
}: {
  kind: NenFeedingKind
  bare?: boolean
  title: string
  description: string
  defaultHead: string
  defaultChip: string
  makeDefault: string
  addLabel: string
  drafts: FeedingDraft[]
  onUpdate: (index: number, patch: Partial<FeedingDraft>) => void
  onDefault: (index: number) => void
  onRemove: (index: number) => void
  onAdd: () => void
  disabledAdd: boolean
}) {
  const rows = drafts.map((row, index) => ({ row, index })).filter(({ row }) => row.kind === kind)
  const body = (
    <>
      <DataTable>
        <thead>
          <TableHeadRow>
            <Th>商品名</Th>
            <Th className="w-44">100g あたり</Th>
            <Th className="w-32">{defaultHead}</Th>
            <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {rows.map(({ row, index }) => (
            <Tr key={row.id ?? `new-${index}`}>
              <Td>
                <TextField aria-label={`商品名 ${index + 1}`} value={row.name} maxLength={40} placeholder={kind === 'nen' ? '例：然 鹿肉ジャーキー' : '例：ドライフード'} onChange={(event) => onUpdate(index, { name: event.target.value })} />
              </Td>
              <Td>
                <span className="flex items-center gap-2">
                  <TextField aria-label={`100gあたりのカロリー ${index + 1}`} inputMode="decimal" value={row.kcal} placeholder="360" onChange={(event) => onUpdate(index, { kcal: event.target.value })} />
                  <span className="shrink-0 text-caption font-semibold text-ink-faint">kcal</span>
                </span>
              </Td>
              <Td>
                {row.isDefault ? (
                  <Chip tone="ok">{defaultChip}</Chip>
                ) : (
                  <button type="button" className={styles.addRow} onClick={() => onDefault(index)}>{makeDefault}</button>
                )}
              </Td>
              <Td align="right">
                <button type="button" className={styles.addRow} aria-label={`${row.name || 'この商品'}を削除する`} onClick={() => onRemove(index)}>削除</button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </DataTable>
      <div>
        <button type="button" className={styles.addRow} onClick={onAdd} disabled={disabledAdd}>
          {addLabel}
        </button>
      </div>
    </>
  )
  if (bare) return <>{body}</>
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardDesc}>{description}</p>
      {body}
    </section>
  )
}

/**
 * ペットの情報を直す（eLjeQ）。真ん中の小窓。
 * 誕生日を変えると、予約済みの誕生日クーポン配信は新しい誕生日で組み直される。
 * 版つき保存：ほかの人が先に直していたら止めて、入力は残したまま保存し直せる。
 */
function PetEditorV8({ accountId, pet, onClose, onSaved }: {
  accountId: string
  pet: NenPetRow
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(pet.name)
  const [animalType, setAnimalType] = useState(pet.animalType)
  const [gender, setGender] = useState(pet.gender)
  const [birthday, setBirthday] = useState(birthdayDraft(pet.birthday))
  const [breed, setBreed] = useState(pet.breed)
  const [weight, setWeight] = useState(pet.weightKg == null ? '' : String(pet.weightKg))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState<string | null>(pet.updatedAt)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (saving) return
    const normalized = normalizeBirthdayInput(birthday)
    if (normalized === 'invalid') {
      setError('誕生日は「2020-03-15」か「03-15」（月日だけ）で入力してください。')
      return
    }
    const weightKg = weight.trim() === '' ? null : Number(weight)
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 200)) {
      setError('体重は 0.1〜200kg で入力してください。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await api.nenCampaigns.updatePet(accountId, pet.id, {
        name: name.trim(),
        animalType,
        gender,
        birthday: normalized ?? '',
        breed: breed.trim(),
        weightKg,
        expectedUpdatedAt: version ?? pet.updatedAt,
      })
      if (!result.success) throw new Error('ペットを保存できませんでした。')
      onSaved()
      onClose()
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code === 'VERSION_CONFLICT') {
        const latest = (caught.data as { latest?: { updatedAt?: string } } | null)?.latest
        if (latest?.updatedAt) setVersion(latest.updatedAt)
        setError('ほかの人が先にペットの情報を変えました。最新の内容を確認してから、もう一度保存してください。入力した内容はそのまま残っています。')
        onSaved()
        return
      }
      setError(describeApiFailure(caught, 'ペットの保存', {}))
    } finally {
      setSaving(false)
    }
  }

  const pill = (group: string, value: string, label: string, current: string, onPick: (next: string) => void) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={current === value}
      aria-label={`${group}：${label}`}
      className={styles.pill}
      onClick={() => onPick(value)}
    >
      <span aria-hidden="true" className={styles.pillDot} />
      {label}
    </button>
  )

  return (
    <div className={styles.dialogOverlay} data-design-node="eLjeQ" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="ペットの情報を直す">
        <div className={styles.dialogHead}>
          <div>
            <h2 className={styles.dialogTitle}>ペットの情報を直す</h2>
            <p className={styles.dialogDesc}>間違っている項目を直して保存します。誕生日を変えると、予約済みの誕生日クーポン配信は新しい誕生日で組み直されます。</p>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        <div className={styles.dialogPet}>
          <span aria-hidden="true" className={styles.petFace}>{(pet.name || '?').slice(0, 1)}</span>
          <div>
            <p className={styles.dialogPetName}>{pet.callName || pet.name}</p>
            <p className={styles.dialogPetSub}>飼い主 {pet.owner.name}・EC-{pet.owner.customerId ?? '未連携'}</p>
          </div>
        </div>
        <fieldset className={styles.pillGroup}>
          <legend className={styles.fieldLabel}>種別</legend>
          {pill('種別', 'dog', '犬', animalType, (next) => setAnimalType(next as typeof animalType))}
          {pill('種別', 'cat', '猫', animalType, (next) => setAnimalType(next as typeof animalType))}
          {pill('種別', 'other', 'その他', animalType, (next) => setAnimalType(next as typeof animalType))}
        </fieldset>
        <div className={styles.fieldGrid}>
          <label className={styles.fieldLabel}>
            ペットの名前
            <TextField aria-label="ペットの名前" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            品種
            <TextField aria-label="品種" value={breed} maxLength={80} onChange={(event) => setBreed(event.target.value)} />
          </label>
        </div>
        <fieldset className={styles.pillGroup}>
          <legend className={styles.fieldLabel}>性別</legend>
          {pill('性別', 'male', '男の子', gender, (next) => setGender(next as typeof gender))}
          {pill('性別', 'female', '女の子', gender, (next) => setGender(next as typeof gender))}
          {pill('性別', 'unknown', 'わからない', gender, (next) => setGender(next as typeof gender))}
        </fieldset>
        <div className={styles.fieldGrid}>
          <label className={styles.fieldLabel}>
            誕生日
            <TextField aria-label="誕生日" placeholder="2022-04-03" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            体重
            <TextField aria-label="体重" inputMode="decimal" placeholder="9.2 kg" value={weight} onChange={(event) => setWeight(event.target.value)} />
          </label>
        </div>
        <p className={styles.fieldHint}>生まれた年が分からないときは「03-15」のように月日だけを入れます。空欄は未登録です。</p>
        {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
        <div className={styles.dialogFoot}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()} busy={saving} busyLabel="保存しています…">保存する</Button>
        </div>
      </div>
    </div>
  )
}
