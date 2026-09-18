'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { nenPetsApi, type NenPetRow } from '@/lib/nen-pets-api'
import FeedingTab from './feeding-tab'
import PetsTab, { type PetsQuery } from './pets-tab'

export type PetTab = 'pets' | 'feeding'

/**
 * 然-NEN- マイペット。★V6 37-3（`hetvN`）ペット一覧／37-3-A（`HVnzL`）主食のカロリー。
 *
 * ペットの正本は LINE 側。お客様がマイページ（★V6 37-2-A）で登録・更新し、ここでは一覧と「今日の目安」を見る。
 * L 一覧型: 1行目（タブ）→ 数値カード帯 → 案内帯 → 一覧操作 → 表。
 * 「CSVを書き出す」は、いまの絞り込みのまま全件を取り直して書き出す（個人情報を含むので取り扱い注意）。
 */
export default function NenPetsPage() {
  return (
    <Suspense fallback={null}>
      <PetsInner />
    </Suspense>
  )
}

const NEUTERED_LABEL = { yes: '済み', no: 'していない', unknown: 'わからない' } as const

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function petsToCsv(items: NenPetRow[]): string {
  const header = ['ペット名', '呼び名', '性別', '種類', '品種', '誕生日', '年齢', '体重(kg)', '避妊去勢', '運動量', '主食', '1日の目安(g)', '1日の必要カロリー(kcal)', '然の鹿肉の目安(g)', '体重の更新日', '飼い主', 'EC会員ID']
  const lines = items.map((p) => [
    p.name, p.callName, p.gender === 'male' ? '男の子' : p.gender === 'female' ? '女の子' : '未回答', p.animalType === 'cat' ? '猫' : '犬', p.breed, p.birthday ?? '', p.ageLabel, p.weightKg ?? '', NEUTERED_LABEL[p.neutered], p.activityLabel,
    p.productName ?? '', p.feeding?.dailyGrams ?? '', p.feeding?.dailyKcal ?? '', p.feeding?.venisonGrams ?? '', p.updatedAt.slice(0, 10), p.owner.name, p.owner.customerId ?? '',
  ].map(csvCell).join(','))
  return `\uFEFF${[header.join(','), ...lines].join('\n')}`
}

function PetsInner() {
  usePageTitle('マイペット')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const tab: PetTab = params.get('tab') === 'feeding' ? 'feeding' : 'pets'
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [query, setQuery] = useState<PetsQuery>({ q: '', species: '', product: '', weight: '', sort: 'updated_desc' })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)

  const changeTab = (next: PetTab) => router.replace(next === 'pets' ? '/nen/pets' : `/nen/pets?tab=${next}`)

  const exportCsv = async () => {
    if (!selectedAccountId || exporting) return
    setExporting(true)
    setExportError(false)
    try {
      const res = await nenPetsApi.pets(selectedAccountId, { ...query, pageSize: 'all' })
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
    <div data-design-node="hetvN" className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[{ label: '専用機能' }, { label: 'マイペット' }]}
        title="マイペット"
        description=""
        actions={tab === 'pets' ? <Button type="button" onClick={() => void exportCsv()} disabled={exporting || !selectedAccountId}>{exporting ? '書き出しています…' : 'CSVを書き出す'}</Button> : undefined}
      />
      <div data-design="Tabs" data-design-node="pets-tabs">
        <Tabs
          items={[
            { label: 'ペット一覧', count: total, current: tab === 'pets', onClick: () => changeTab('pets') },
            { label: '主食のカロリー', current: tab === 'feeding', onClick: () => changeTab('feeding') },
          ]}
        />
      </div>

      {exportError ? (
        <NoteBar tone="warn">CSVを書き出せませんでした。通信の状態を確認して、もう一度お試しください。</NoteBar>
      ) : null}

      {!selectedAccountId ? null : tab === 'feeding' ? (
        <FeedingTab accountId={selectedAccountId} />
      ) : (
        <PetsTab accountId={selectedAccountId} query={query} onQueryChange={setQuery} onTotal={setTotal} />
      )}
    </div>
  )
}
