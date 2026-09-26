'use client'

import { useCallback, useEffect, useState } from 'react'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { ApiError, api } from '@/lib/api'
import { headCountLabel, nenPetsApi, petAnimalTypeLabel, type NenPetListData, type NenPetRow, type NenPetSort, type NenPetWeightFilter } from '@/lib/nen-pets-api'
import PetEditor from './pet-editor'

type ListStatus = 'loading' | 'ready' | 'error' | 'forbidden'

export type PetsQuery = { q: string; species: string; product: string; weight: NenPetWeightFilter; sort: NenPetSort }

const NEUTERED_LABEL = { yes: '済み', no: 'していない', unknown: 'わからない' } as const

/**
 * ペット一覧タブ。★V6 37-3（`hetvN`）。
 * 列：ペット／飼い主／年齢／体重／今日の目安／避妊去勢／運動量／主食／体重の更新／詳細。
 * 「今日の目安」は表示のたびに Worker が NRC／FEDIAF の式で計算する（保存値ではない）。
 */
export default function PetsTab({
  accountId,
  query,
  onQueryChange,
  onTotal,
}: {
  accountId: string
  query: PetsQuery
  onQueryChange: (next: PetsQuery) => void
  onTotal: (total: number | undefined) => void
}) {
  const [status, setStatus] = useState<ListStatus>('loading')
  const [data, setData] = useState<NenPetListData | null>(null)
  const [draft, setDraft] = useState(query.q)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<NenPetRow | null>(null)
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
      const res = await nenPetsApi.pets(accountId, { ...query, page })
      if (!res.success) throw new Error(res.error)
      setData(res.data)
      onTotal(res.data.kpis.total)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId, query, page, onTotal])

  useEffect(() => {
    void load()
  }, [load])

  const change = (patch: Partial<PetsQuery>) => { onQueryChange({ ...query, ...patch }); setPage(1) }
  const kpis = data?.kpis ?? null
  const ready = status === 'ready' && kpis !== null
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <>
      <KpiCollapse data-design="KPIs" data-design-node="pets-kpis" gridClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard variant="v6" title="登録ペット" value={ready ? kpis!.total : null} unit="頭" detail={ready ? `犬 ${kpis!.dogs}・猫 ${kpis!.cats}` : '—'} loading={!ready && status === 'loading'} />
        <SummaryCard variant="v6" title="今月の新規登録" value={ready ? kpis!.newThisMonth : null} unit="頭" detail="" help="1日から今日までに登録されたペットです" loading={!ready && status === 'loading'} />
        <SummaryCard variant="v6" title="目安を出せるペット" value={ready ? kpis!.computable : null} unit="頭" detail="" help="体重と主食が揃っているペットです" loading={!ready && status === 'loading'} />
        <SummaryCard variant="v6" title="体重が未更新（90日）" value={ready ? kpis!.staleWeight : null} unit="頭" detail="マイページで更新を促す" loading={!ready && status === 'loading'} />
      </KpiCollapse>

      <div data-design="Note" data-design-node="pets-note">
        <NoteBar tone="info" help="体重・年齢・避妊去勢・運動量から公的な指針の式で計算します" helpLabel="今日の目安の計算">
          「今日の目安」は 体重・年齢・避妊去勢・運動量 から公的な指針（NRC／FEDIAF）の式で計算し、「主食のカロリー」タブの kcal でグラムにします。「鹿肉」は然の商品（おやつ）の1日の目安です。ペットはお客様のマイページからも登録・変更できます。
        </NoteBar>
      </div>

      <div data-design="ListControls" data-design-node="pets-controls" className="flex flex-wrap items-center gap-3">
        <form
          className="min-w-64 flex-1"
          onSubmit={(event) => { event.preventDefault(); change({ q: draft.trim() }) }}
        >
          <TextField
            aria-label="ペットを検索"
            placeholder="ペット名・飼い主・EC会員IDで検索"
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
        <span className="ml-auto text-caption font-semibold text-ink-faint">
          {data ? headCountLabel(data.total, data.page, data.pageSize) : '—'}
        </span>
      </div>

      <section data-design="Table" data-design-node="pets-table">
        {status === 'loading' && !data ? (
          <ListState kind="loading" title="ペットを読み込んでいます" />
        ) : status === 'forbidden' ? (
          <ListState kind="forbidden" />
        ) : status === 'error' ? (
          <ListState kind="error" title="ペットを読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={() => void load()} />
        ) : data && data.items.length === 0 ? (
          <ListState kind="empty" emptyPreset="readonly" title="まだペットがいません" description="お客様がマイページでペットを登録すると、ここに並びます。" />
        ) : data ? (
          <>
            {/*
              #984 LAY-17: スマホでは細い表の操作列に「編集」「詳細」を
              押し込まず、カードの下に操作行を持つカードへ切り替える。
            */}
            <ul className="divide-hairline divide-y rounded-card border-hairline border bg-canvas md:hidden" data-design="PetCards">
              {data.items.map((pet) => <PetCard key={pet.id} pet={pet} canEdit={canEdit} onEdit={() => setEditing(pet)} />)}
            </ul>
            <div className="hidden md:block">
            <DataTable>
              <thead>
                <TableHeadRow>
                  {/*
                    1440pxで表がはみ出さないよう、固定幅の合計を容器（1103px）
                    に収める。操作列 w-40 は LAY-17 の契約で保つ。
                    伸ばすのは文字の主食の列だけ（全ルート監査、2026-09-25）。
                  */}
                  <Th className="w-48">ペット</Th>
                  <Th className="w-36">飼い主</Th>
                  <Th className="w-20">年齢</Th>
                  <Th className="w-20" align="right">体重</Th>
                  <Th className="w-28">今日の目安</Th>
                  <Th className="w-24">避妊去勢</Th>
                  <Th className="w-20">運動量</Th>
                  <Th>主食</Th>
                  <Th className="w-20">体重の更新</Th>
                  {/*
                    「飼い主」「編集」の枠付きボタンが横に並べて入る幅を
                    先に確保する（LAY-17/18）。
                  */}
                  <Th className="w-40" align="right"><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {data.items.map((pet) => <PetRow key={pet.id} pet={pet} canEdit={canEdit} onEdit={() => setEditing(pet)} />)}
              </tbody>
            </DataTable>
            </div>
            {pageCount > 1 ? <Pagination page={data.page} pageCount={pageCount} onPageChange={setPage} /> : null}
          </>
        ) : null}
      </section>
      <PetEditor accountId={accountId} pet={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </>
  )
}

function PetRow({ pet, canEdit, onEdit }: { pet: NenPetRow; canEdit: boolean; onEdit: () => void }) {
  const initial = (pet.name || '?').slice(0, 1)
  const kind = petAnimalTypeLabel(pet.animalType)
  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-3">
          {pet.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- お客様がマイページで登録した写真
            <img src={pet.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-pill object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-bold text-accent-deep">{initial}</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-label font-semibold text-ink" title={pet.callName}>{pet.callName || pet.name || '（名前なし）'}</span>
            <span className="block truncate text-micro text-ink-faint">{pet.breed ? `${kind}・${pet.breed}` : kind}</span>
          </span>
        </span>
      </Td>
      <Td>
        <span className="block truncate text-label text-ink" title={pet.owner.name}>{pet.owner.name || '（名前なし）'}</span>
        <span className="block truncate text-micro text-ink-faint">{pet.owner.customerId ? `EC会員 ${pet.owner.customerId}` : 'EC未連携'}</span>
      </Td>
      <Td><span className="text-label text-ink-secondary">{pet.ageLabel}</span></Td>
      <Td align="right"><span className="text-label tabular-nums text-ink">{pet.weightKg == null ? '—' : `${pet.weightKg}kg`}</span></Td>
      <Td>
        {pet.feeding?.dailyGrams != null ? (
          <>
            <span className="block text-label font-semibold tabular-nums text-ink">{pet.feeding.dailyGrams}g／日</span>
            <span className="block text-micro text-ink-faint">{`約${pet.feeding.dailyKcal}kcal${pet.feeding.stageLabel && pet.feeding.stageLabel !== '成犬' && pet.feeding.stageLabel !== '成猫' ? `・${pet.feeding.stageLabel}` : ''}${pet.feeding.venisonGrams != null ? `・鹿肉 ${pet.feeding.venisonGrams}g` : ''}`}</span>
          </>
        ) : pet.feeding ? (
          <>
            <span className="block text-label text-ink-secondary">—</span>
            <span className="block text-micro text-ink-faint">{`約${pet.feeding.dailyKcal}kcal・主食が未設定${pet.feeding.venisonGrams != null ? `・鹿肉 ${pet.feeding.venisonGrams}g` : ''}`}</span>
          </>
        ) : (
          <>
            <span className="block text-label text-ink-secondary">—</span>
            {/* #999 DEEP-24: 犬・猫以外はNRC/FEDIAFの計算対象外。犬の式で出した数値を見せない。 */}
            <span className="block text-micro text-ink-faint">{pet.animalType === 'other' ? '犬・猫以外は目安の計算対象外' : pet.weightKg == null ? '体重が未登録' : '誕生日が未登録'}</span>
          </>
        )}
      </Td>
      <Td><span className="block truncate text-label text-ink-secondary" title={NEUTERED_LABEL[pet.neutered]}>{NEUTERED_LABEL[pet.neutered]}</span></Td>
      <Td><span className="block truncate text-label text-ink-secondary" title={pet.activityLabel}>{pet.activityLabel}</span></Td>
      <Td><span className="block truncate text-label text-ink-secondary" title={pet.productName ?? '（未設定）'}>{pet.productName ?? '（未設定）'}</span></Td>
      <Td>
        {pet.weightStale ? (
          <Chip tone="warn">{pet.updatedAt.slice(5, 10).replace('-', '/')}</Chip>
        ) : (
          <span className="text-label text-ink-secondary">{pet.updatedAt.slice(5, 10).replace('-', '/')}</span>
        )}
      </Td>
      {/*
        #985 LAY-18: 操作は共用の RowActions。「詳細」が先頭・「編集」が
        その次の枠付き補助ボタン。文字リンクの直書きへは戻さない。
        ここの「詳細」の行き先はペットではなく飼い主の友だち詳細なので、
        監査の指摘どおり行き先が分かる「飼い主」と明記する。
      */}
      <ActionCell>
        <RowActions
          subjectName={pet.callName || pet.name || '（名前なし）'}
          detail={{ label: '飼い主', href: `/friends/detail?id=${encodeURIComponent(pet.owner.friendId)}` }}
          edit={canEdit ? { onClick: onEdit } : undefined}
        />
      </ActionCell>
    </Tr>
  )
}

/**
 * スマホ幅のカード（#984 LAY-17）。
 * 表の10列を狭い画面へ並べる代わりに、名まえ・飼い主・今日の目安だけを
 * 上にまとめ、「編集」「詳細」はカードの下の操作行に置く。
 */
function PetCard({ pet, canEdit, onEdit }: { pet: NenPetRow; canEdit: boolean; onEdit: () => void }) {
  const initial = (pet.name || '?').slice(0, 1)
  const kind = petAnimalTypeLabel(pet.animalType)
  return (
    <li className="p-4">
      <div className="flex min-w-0 items-start gap-3">
        {pet.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- お客様がマイページで登録した写真
          <img src={pet.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-pill object-cover" />
        ) : (
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-caption font-bold text-accent-deep">{initial}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink" title={pet.callName}>{pet.callName || pet.name || '（名前なし）'}</p>
          <p className="mt-0.5 truncate text-xs text-ink-faint">{pet.breed ? `${kind}・${pet.breed}` : kind}</p>
          <p className="mt-0.5 truncate text-xs text-ink-faint">{pet.owner.name || '（名前なし）'}</p>
        </div>
        <div className="shrink-0 text-right text-xs text-ink-secondary">
          <p>{pet.ageLabel}</p>
          <p className="tabular-nums">{pet.weightKg == null ? '—' : `${pet.weightKg}kg`}</p>
        </div>
      </div>
      {pet.feeding?.dailyGrams != null ? (
        <p className="mt-2 text-xs text-ink-secondary">
          今日の目安 <span className="font-semibold tabular-nums text-ink">{pet.feeding.dailyGrams}g／日</span>
        </p>
      ) : pet.animalType === 'other' ? (
        /* #999 DEEP-24: 犬・猫以外は目安の計算対象外と明示する（犬の数値を見せない）。 */
        <p className="mt-2 text-xs text-ink-faint">今日の目安は犬・猫のみ計算できます</p>
      ) : null}
      {/* 操作はカードの下の行。表と同じ RowActions で順・見た目を揃える。 */}
      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3" data-design="CardActions">
        <RowActions
          subjectName={pet.callName || pet.name || '（名前なし）'}
          detail={{ label: '飼い主', href: `/friends/detail?id=${encodeURIComponent(pet.owner.friendId)}` }}
          edit={canEdit ? { onClick: onEdit } : undefined}
        />
      </div>
    </li>
  )
}
