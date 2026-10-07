'use client'

/*
 * ★V8 マイペットの小さな部品（CSV・言葉・誕生日の形・行の「…」・件数の文）。
 * 今の画面（app/nen/pets の page.tsx・pet-editor.tsx）から写した。
 * src/v8 は @/app を読めないので、同じ約束のまま持つ。
 */
import { useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { csvCell } from '@/lib/presentation'
import { formatNumber } from '@/lib/format'
import { petAnimalTypeLabel, type NenPetRow, type NenPetSort, type NenPetWeightFilter } from '@/lib/nen-pets-api'
import styles from './pets.module.css'

export type PetTab = 'pets' | 'feeding'
export type PetsQuery = { q: string; species: string; product: string; weight: NenPetWeightFilter; sort: NenPetSort }
export const EMPTY_QUERY: PetsQuery = { q: '', species: '', product: '', weight: '', sort: 'updated_desc' }

export const NEUTERED_LABEL = { yes: '済み', no: 'していない', unknown: 'わからない' } as const

/*
 * #999 DEEP-25: CSV の1マス整形は共通の csvCell（先頭の = + - @ に ' を足す）。
 * #999 DEEP-24: 種類は共通の動物種別ラベル。「その他」を犬へ変換しない。
 * 列と並びは今の画面（v7）と同じ。
 */
export function petsToCsv(items: NenPetRow[]): string {
  const header = ['ペット名', '呼び名', '性別', '種類', '品種', '誕生日', '年齢', '体重(kg)', '避妊去勢', '運動量', '主食', '1日の目安(g)', '1日の必要カロリー(kcal)', '然の鹿肉の目安(g)', '体重の更新日', '飼い主', 'EC会員ID']
  const lines = items.map((p) => [
    p.name, p.callName, p.gender === 'male' ? '男の子' : p.gender === 'female' ? '女の子' : '未回答', petAnimalTypeLabel(p.animalType), p.breed, p.birthday ?? '', p.ageLabel, p.weightKg ?? '', NEUTERED_LABEL[p.neutered], p.activityLabel,
    p.productName ?? '', p.feeding?.dailyGrams ?? '', p.feeding?.dailyKcal ?? '', p.feeding?.venisonGrams ?? '', p.weightUpdatedAt.slice(0, 10), p.owner.name, p.owner.customerId ?? '',
  ].map(csvCell).join(','))
  return `﻿${[header.join(','), ...lines].join('\n')}`
}

export function downloadCsv(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** 誕生日の入力。空＝未登録（null）、「2020-03-15」か月日だけ「03-15」。ほかは 'invalid'。 */
export function normalizeBirthdayInput(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{2}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return 'invalid'
}

/** 「09/28」（体重の更新日）。日付が無ければ「—」。 */
export function monthDay(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '—'
  return value.slice(5, 10).replace('-', '/')
}

/** 件数の文（「8件中 1〜8件」）。 */
export function rangeText(total: number, page: number, size: number): string {
  if (total === 0) return '0件'
  return `${formatNumber(total)}件中 ${(page - 1) * size + 1}〜${Math.min(total, page * size)}件`
}

/**
 * 今日の目安の2行目。鹿肉の目安があれば「約560kcal・鹿肉 12g」、
 * 無ければ成長の段階（子犬・子猫・シニア）だけ添える。主食が未設定なら「主食が未設定」。
 * #999 DEEP-24: 犬・猫以外は計算しない（犬の式で出した数値を見せない）。
 */
export function feedingLines(pet: NenPetRow): { main: string; sub: string } {
  const f = pet.feeding
  if (!f) {
    return { main: '—', sub: pet.animalType === 'other' ? '犬・猫以外は目安の計算対象外' : pet.weightKg == null ? '体重が未登録' : '誕生日が未登録' }
  }
  const kcal = `約${formatNumber(f.dailyKcal)}kcal`
  if (f.dailyGrams == null) return { main: '—', sub: `${kcal}・主食が未設定` }
  const extra = f.venisonGrams != null ? `・鹿肉 ${f.venisonGrams}g` : /子|シニア/.test(f.stageLabel) ? `・${f.stageLabel}` : ''
  return { main: `${formatNumber(f.dailyGrams)}g／日`, sub: `${kcal}${extra}` }
}

/** 状態の札（点＋文字）。 */
export function Pill({ tone, children, title }: { tone: 'ok' | 'warn' | 'off'; children: ReactNode; title?: string }) {
  return (
    <span className={styles.pill} data-tone={tone} title={title}>
      <span className={styles.pillDot} aria-hidden="true" />
      {children}
    </span>
  )
}

/** 行の右端の「…」。押すと行の操作のメニュー（右クリックだけにしない）。 */
export function RowMenu({ subject, items }: { subject: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  if (items.length === 0) return <span className={styles.menuSpace} aria-hidden="true" />
  return (
    <span className={styles.menuBox}>
      <button
        ref={anchorRef}
        type="button"
        className={styles.menuButton}
        aria-label={`「${subject}」の操作`}
        title={`「${subject}」の操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      <ActionMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        ariaLabel={`「${subject}」の操作`}
        items={items.map((item) => ({ ...item, onSelect: () => { setOpen(false); item.onSelect?.() } }))}
      />
    </span>
  )
}
