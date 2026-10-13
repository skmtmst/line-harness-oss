'use client'

import ReadOnlyNotice from '@/components/shared/read-only-notice';
import { Check, Smartphone } from 'lucide-react';
import StickyBar from '@/components/shared/sticky-bar';
import { notifyToast } from '@/components/shared/toast';
import Button from '@/components/shared/button';
import ConfirmDialog from '@/components/shared/confirm-dialog';
import Dialog from '@/components/shared/dialog';
import { Tabs } from '@/components/shared/tabs';
import { V8TabEditContext, AccountIcon, StateCard } from './tabs/shared';
import styles from './settings.module.css';
import ChannelsTabV8 from './channels-tab';
import MenuSettingsPage from './menu-settings-page'
import { PageHeading } from '@/components/templates/page-frame';
import type { ReactNode } from 'react'
import type { useBookingSettings } from './settings'
import { HoursTabV8, HolidaysTabV8, RulesTabV8, StaffTabV8, V8_TABS } from './settings-parts'

export default function BookingSettingsView({ accountId, tab, previewUrl, tabNode, canEditMenus, canEditSettings, tabReadOnly, menus, menusStatus, menusError, settings, settingsStatus, settingsError, staff, staffStatus, staffError, staffMatrices, staffExtras, phoneOpen, setPhoneOpen, members, resources, resourcesStatus, resourcesError, closedBookingCount, storeExceptions, tabEdit, hasChanges, menuFormState, registerTabEdit, switchTarget, setSwitchTarget, leaveTarget, confirmLeave, cancelLeave, requestTab, confirmSwitch, reloadCore, saveSettings, saveResource, createResource, deleteResource, retryResources, closedWeekdays, phone }: ReturnType<typeof useBookingSettings> & { phone: ReactNode }) {
  return (
    <V8TabEditContext.Provider value={registerTabEdit}>
      {tab === 'menus' ? <MenuSettingsPage {...{ accountId, tabNode, canEditMenus, menus, menusStatus, menusError, settings, reloadCore, previewUrl, phone, setPhoneOpen, requestTab, menuFormState }} /> : <div className={styles.shell} data-design-node="owaS3">
        <PageHeading title={<>予約設定</>}
        help={<>お客さまの予約画面に出るメニュー・時間・ルールを決めます</>}
        tabs={<><Tabs
              label="予約設定のタブ"
              items={V8_TABS.map((item) => ({
                label: item.label,
                current: item.key === tab,
                onClick: () => requestTab(item.key),
              }))}
            /></>} />

        {accountId && tabReadOnly ? (
          <div className={styles.readOnlyRow} data-design="Bar">
            <ReadOnlyNotice />
          </div>
        ) : null}

        <div className={styles.body} data-design="Body">
          <div className={tab === 'channels' ? `${styles.main} ${styles.mainChannels}` : styles.main} data-design-node={tabNode}>
            {!accountId ? (
              <StateCard
                icon={<AccountIcon />}
                title="LINEアカウントを選んでください"
                description="共通メニューで、予約設定を開くLINEアカウントを選んでください。"
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
          </div>

          {/* 予約経路の連携は横に広い表なので、右のスマホを出さず全幅にする（絵 ZyDd6）。 */}
          {tab === 'channels' ? null : (
          <aside className={styles.side} data-design="Side">
            <div className={styles.sideActions}>
              <span className={styles.sidePhoneButton}>
                <Button onClick={() => setPhoneOpen(true)}><Smartphone size={15} aria-hidden="true" />LINEでの見え方を見る</Button>
              </span>
              {previewUrl ? <Button href={previewUrl}><Smartphone size={15} aria-hidden="true" />お客さまに見える画面を確かめる</Button> : null}
            </div>
            <p className={styles.sideTitle}>お客さまの予約画面</p>
            <div className={styles.sidePhone}>{phone}</div>
            {previewUrl ? null : (
              <p className={styles.sideLineLink}>このアカウントには予約画面のURLがまだありません</p>
            )}
          </aside>
          )}
        </div>

        {/* 下の帯（追従・常に画面の下）。キャンセル・保存は中央（絵 yRPxl・x1OZS6）。
            変えられない人（閲覧のみ）には押せないボタンを置かないので帯ごと出さない。 */}
        {tabEdit && tabEdit.showBar !== false && !tabEdit.saveDisabled ? (
          <div className={styles.saveBarWrap} data-design="Savebar">
            <StickyBar
              status={hasChanges ? (
                <span className={styles.saveBarStatus}>
                  <span className={styles.saveBarStatusDot} aria-hidden="true" />
                  {tabEdit.subject}があります
                </span>
              ) : undefined}
              actions={(
                <>
                  <Button onClick={() => tabEdit.onReset()} disabled={tabEdit.saving}>キャンセル</Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!hasChanges) {
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
              )}
            />
          </div>
        ) : null}
      </div>}

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
      {/* 板 VFxWU（1152）：畳んだスマホの代わりに見せる窓。実行ボタンなしの参照窓。 */}
      <Dialog
        open={phoneOpen}
        title="お客さまの予約画面"
        onCancel={() => setPhoneOpen(false)}
      >
        {phone}
      </Dialog>
    </V8TabEditContext.Provider>
  )
}
