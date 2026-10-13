'use client'

import type { ReactNode } from 'react'
import { Check, Smartphone } from 'lucide-react'
import { CreatePage } from '@/components/templates/create-page'
import PreviewLauncher from '@/components/templates/preview-launcher'
import { notifyToast } from '@/components/shared/toast'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Tabs } from '@/components/shared/tabs'
import { V8TabEditContext, AccountIcon, StateCard } from './tabs/shared'
import styles from './settings.module.css'
import ChannelsTabV8 from './channels-tab'
import type { useBookingSettings } from './settings'
import { MenusTabV8, HoursTabV8, HolidaysTabV8, RulesTabV8, StaffTabV8, V8_TABS } from './settings-parts'

export default function BookingSettingsView({ accountId, tab, previewUrl, tabNode, canEditMenus, canEditSettings, tabReadOnly, menus, menusStatus, menusError, settings, settingsStatus, settingsError, staff, staffStatus, staffError, staffMatrices, staffExtras, members, resources, resourcesStatus, resourcesError, closedBookingCount, storeExceptions, tabEdit, registerTabEdit, switchTarget, setSwitchTarget, requestTab, confirmSwitch, reloadCore, saveSettings, saveResource, createResource, deleteResource, retryResources, closedWeekdays, phone }: ReturnType<typeof useBookingSettings> & { phone: ReactNode }) {
  const previewContent = <>
            <div className={styles.sideActions}>
              {previewUrl ? <Button href={previewUrl}><Smartphone size={15} aria-hidden="true" />お客さまに見える画面を確かめる</Button> : null}
            </div>
            <p className={styles.sideTitle}>お客さまの予約画面</p>
            {phone}
            {previewUrl ? null : (
              <p className={styles.sideLineLink}>このアカウントには予約画面のURLがまだありません</p>
            )}
  </>

  return (
    <V8TabEditContext.Provider value={registerTabEdit}>
      <CreatePage
        boardId={tab === 'menus' && !canEditMenus ? 'C9fv7A' : tabNode}
        dirty={false}
        readOnly={Boolean(accountId && tabReadOnly)} title={<>予約設定</>}
        help={<>お客さまの予約画面に出るメニュー・時間・ルールを決めます</>}
        tabs={<><Tabs
              label="予約設定のタブ"
              items={V8_TABS.map((item) => ({
                label: item.label,
                current: item.key === tab,
                onClick: () => requestTab(item.key),
              }))}
            /></>}


        preview={tab === 'channels' ? undefined : previewContent}
        previewToggle={tab === 'channels' ? undefined : <PreviewLauncher title="お客さまの予約画面" label="LINEでの見え方を見る">{previewContent}</PreviewLauncher>}
        footerActions={tabEdit && tabEdit.showBar !== false && !tabEdit.saveDisabled ? (
                <>
                  <Button onClick={() => tabEdit.onReset()} disabled={tabEdit.saving}>キャンセル</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!tabEdit.dirty) {
                        notifyToast('変更はありません。')
                        return
                      }
                      tabEdit.onSave()
                    }}
                    disabled={tabEdit.saving}
                    busy={tabEdit.saving}

                  >
                    <Check size={15} aria-hidden="true" />{tabEdit.saveLabel ?? '保存する'}
                  </Button>
                </>
              ) : null}
        status={tabEdit?.dirty ? `${tabEdit.subject}があります` : undefined}
      >
            {!accountId ? (
              <StateCard
                icon={<AccountIcon />}
                title="LINEアカウントを選んでください"
                description="共通メニューで、予約設定を開くLINEアカウントを選んでください。"
              />
            ) : tab === 'menus' ? (
              <MenusTabV8
                accountId={accountId}
                menus={menus}
                status={menusStatus}
                error={menusError}
                menuCount={settings?.menuCount}
                canEdit={canEditMenus}
                onReload={reloadCore}
              />
            ) : tab === 'hours' ? (
              <HoursTabV8
                accountId={accountId}
                settings={settings}
                settingsStatus={settingsStatus}
                settingsError={settingsError}
                resources={resources}
                resourcesStatus={resourcesStatus}
                resourcesError={resourcesError}
                canEdit={canEditSettings}
                menus={menus}
                onSaved={saveSettings}
                onReload={reloadCore}
                onResourceSaved={saveResource}
                onResourceCreated={createResource}
                onResourceDeleted={deleteResource}
                onResourcesRetry={retryResources}
              />
            ) : tab === 'holidays' ? (
              <HolidaysTabV8
                accountId={accountId}
                settings={settings}
                status={settingsStatus}
                error={settingsError}
                exceptions={storeExceptions}
                closedWeekdays={closedWeekdays}
                bookingCountOnClosed={closedBookingCount}
                canEdit={canEditSettings}
                onSaved={saveSettings}
                onReload={reloadCore}
              />
            ) : tab === 'rules' ? (
              <RulesTabV8
                accountId={accountId}
                settings={settings}
                status={settingsStatus}
                error={settingsError}
                staff={staff}
                staffReady={staffStatus === 'ready'}
                canEdit={canEditSettings}
                onSaved={saveSettings}
                onReload={reloadCore}
              />
            ) : tab === 'staff' ? (
              <StaffTabV8
                accountId={accountId}
                staff={staff}
                status={staffStatus}
                error={staffError}
                matrices={staffMatrices}
                extras={staffExtras}
                members={members}
                canEdit={canEditSettings}
                onReload={reloadCore}
              />
            ) : (
              <ChannelsTabV8 accountId={accountId} canEdit={canEditSettings} staff={staff} />
            )}
      </CreatePage>

      {/* タブをまたぐときの破棄確認（タブ内のデータは外れると消える）。 */}
      <ConfirmDialog
        open={switchTarget !== null}
        title={`${tabEdit?.subject ?? '変更'}を捨てて移りますか？`}
        description="保存していない変更は消えます。"
        confirmLabel="捨てて移る"
        cancelLabel="編集に戻る"
        primaryAction="cancel"
        onCancel={() => setSwitchTarget(null)}
        onConfirm={confirmSwitch}
      />

    </V8TabEditContext.Provider>
  )
}