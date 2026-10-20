'use client'

import type { ReactNode } from 'react'
import { Smartphone } from 'lucide-react'
import Button from '@/components/shared/button'
import { Tabs } from '@/components/shared/tabs'
import { CreatePage } from '@/components/templates/create-page'
import { CreatePreviewNote, CreateSummaryCard } from '@/components/templates/create-parts'
import { AccountIcon, StateCard } from './tabs/shared'
import { MenusTabV8, V8_TABS } from './settings-parts'
import type { useBookingSettings } from './use-booking-settings'

type MenuPageProps = Pick<ReturnType<typeof useBookingSettings>,
  'accountId' | 'tabNode' | 'canEditMenus' | 'menus' | 'menusStatus' | 'menusError' |
  'settings' | 'reloadCore' | 'previewUrl' | 'setPhoneOpen' | 'requestTab' | 'menuFormState'> & { phone: ReactNode }

export default function MenuSettingsPage({ accountId, tabNode, canEditMenus, menus, menusStatus, menusError, settings, reloadCore, previewUrl, phone, setPhoneOpen, requestTab, menuFormState }: MenuPageProps) {
  const customerLink = previewUrl ? <Button href={previewUrl}>
    <Smartphone aria-hidden="true" />お客さまに見える画面を確かめる
  </Button> : null

  return <CreatePage
    boardId={canEditMenus ? tabNode : 'C9fv7A'}
    title="予約設定"
    help="お客さまの予約画面に出るメニュー・時間・ルールを決めます"
    readOnly={!!accountId && !canEditMenus}
    {...menuFormState}
    footerActions={null}
    tabs={<Tabs label="予約設定のタブ" items={V8_TABS.map(item => ({
      label: item.label, current: item.key === 'menus', onClick: () => requestTab(item.key),
    }))} />}
    previewToggle={<>
      <Button onClick={() => setPhoneOpen(true)}><Smartphone aria-hidden="true" />LINEでの見え方を見る</Button>
      {customerLink}
    </>}
    preview={<>
      {customerLink}
      <CreateSummaryCard title="お客さまの予約画面" rows={[]}>{phone}</CreateSummaryCard>
      {!previewUrl ? <CreatePreviewNote>このアカウントには予約画面のURLがまだありません</CreatePreviewNote> : null}
    </>}
  >
    {accountId ? <MenusTabV8
      accountId={accountId} menus={menus} status={menusStatus} error={menusError}
      menuCount={settings?.menuCount} canEdit={canEditMenus} onReload={reloadCore}
    /> : <StateCard icon={<AccountIcon />} title="LINEアカウントを選んでください"
      description="共通メニューで、予約設定を開くLINEアカウントを選んでください。" />}
  </CreatePage>
}
