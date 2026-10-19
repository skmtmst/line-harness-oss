'use client'

import { SettingsMenu } from '@/components/layout/settings-inner-nav'
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation'
import type { ListFolderNav } from '@/components/templates'
import { Building2, CreditCard, LifeBuoy, Users } from 'lucide-react'

export type HqSettingsNavKey = 'members' | 'info' | 'billing' | 'contact'

const ITEMS: { key: HqSettingsNavKey; label: string; href: string; Icon: typeof Users }[] = [
  { key: 'members', label: 'メンバー', href: '/hq/members', Icon: Users },
  { key: 'info', label: '統括の情報', href: '/hq/settings', Icon: Building2 },
  { key: 'billing', label: '請求', href: '/hq/billing', Icon: CreditCard },
  { key: 'contact', label: 'お問い合わせ', href: '/hq/support', Icon: LifeBuoy },
]

/**
 * ★V8 統括の設定の中のメニュー（絵の の左の列）。
 * 形は店の設定と同じ共通の「設定の中のメニュー」（components/layout/settings-inner-nav の SettingsMenu）。
 * 型（ListPage）のフォルダの列に入れて使う（placement="folder"）。列の幅・余白・仕切り線は型が持つ。
 * 印は絵どおり（メンバー users・統括の情報 building-2・請求 credit-card・お問い合わせ life-buoy）。
 * 絵の列は中身の高さで止まる（縦の仕切り線も中身まで）ので、型に `data-folder-fit` で知らせる。
 */
export default function HqSettingsNavV8({ active }: { active: HqSettingsNavKey }) {
  return (
    <SettingsMenu
      heading="統括の設定"
      label="統括の設定"
      placement="folder"
      fit
      entries={ITEMS.map(({ key, label, href, Icon }) => ({ href, label, Icon, active: key === active }))}
    />
  )
}

/**
 * 白い板が狭く左の列が畳まれたとき、型（ListPage の folderNav）が道具の段に出す「設定：〇〇」の選ぶ欄。
 * 行き先・並びは左の列と同じ。
 */
export function useHqSettingsFolderNav(active: HqSettingsNavKey): ListFolderNav {
  const router = useRouter()
  return {
    label: '設定',
    rows: ITEMS.map(({ key, label }) => ({ id: key, label })),
    activeId: active,
    onSelect: (id) => {
      const item = ITEMS.find((candidate) => candidate.key === id)
      if (item && item.key !== active) router.push(item.href)
    },
  }
}
