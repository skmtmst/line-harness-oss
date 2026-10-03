'use client'

/*
 * V8 予約設定の写真タブ（B-1『店の写真』）。
 *
 * お店・メニュー・担当スタッフに1枚ずつ、登録メディアから選んで付ける。
 * 空の枠は『写真を選ぶ』。使っている写真は選ぶ窓に「Nか所で使用中・削除不可」
 * と出る（登録メディアからは消せない）。選んだらその場で保存する。
 *
 * テーマが v7 のときはこのファイルは読まれず、従来の見た目が出る。
 */
import { useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { notifyToast } from '@/components/shared/toast'
import MediaPickerDialog from '@/app/contents/media-picker-dialog'
import {
  bookingApi,
  type BookingMenu,
  type BookingSettings,
  type BookingStaff,
} from '@/lib/api'
import type { MediaItem } from '@line-crm/shared'
import { bookingErrorMessage, bookingRulesErrorMessage } from './menu-validation'
import styles from './settings-v8.module.css'
import photoStyles from './photos-v8.module.css'

type PickerTarget =
  | { scope: 'store' }
  | { scope: 'menu', id: string, name: string, version: number | undefined }
  | { scope: 'staff', id: string, name: string }

function targetName(target: PickerTarget, settings: BookingSettings | null): string {
  if (target.scope === 'store') return 'お店'
  if (target.scope === 'menu') return target.name
  return target.name
}

function PhotoSlot({
  name,
  photoUrl,
  canEdit,
  saving,
  onChoose,
  onClear,
}: {
  name: string
  photoUrl: string | null
  canEdit: boolean
  saving: boolean
  onChoose: () => void
  onClear: () => void
}) {
  if (photoUrl) {
    return (
      <span className={photoStyles.slot}>
        <img src={photoUrl} alt={`${name}の写真`} className={photoStyles.thumb} />
        {canEdit ? (
          <span className={photoStyles.slotActions}>
            <Button onClick={onChoose} disabled={saving} aria-label={`${name}の写真を替える`}>
              替える
            </Button>
            <Button onClick={onClear} disabled={saving} aria-label={`${name}の写真を外す`}>
              外す
            </Button>
          </span>
        ) : null}
      </span>
    )
  }
  if (!canEdit) {
    return <span className={photoStyles.emptyNote}>写真なし</span>
  }
  return (
    <Button
      onClick={onChoose}
      disabled={saving}
      aria-label={`${name}の写真を選ぶ`}
      className={photoStyles.emptySlot}
    >
      写真を選ぶ
    </Button>
  )
}

export default function PhotosTabV8({
  accountId,
  menus,
  menusStatus,
  menusError,
  staff,
  staffStatus,
  staffError,
  settings,
  settingsStatus,
  settingsError,
  canEditMenus,
  canEditSettings,
  onReload,
}: {
  accountId: string
  menus: BookingMenu[]
  menusStatus: 'loading' | 'ready' | 'error'
  menusError: string | null
  staff: BookingStaff[]
  staffStatus: 'loading' | 'ready' | 'error'
  staffError: string | null
  settings: BookingSettings | null
  settingsStatus: 'loading' | 'ready' | 'error'
  settingsError: string | null
  canEditMenus: boolean
  canEditSettings: boolean
  onReload: () => void
}) {
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const canEditAny = canEditMenus || canEditSettings

  async function saveStorePhoto(mediaId: string | null) {
    if (!settings) return
    setSavingKey('store')
    setSaveError(null)
    try {
      const response = await bookingApi.saveSettings(accountId, {
        expectedVersion: settings.version,
        timeZone: settings.timeZone,
        bookingWindowDays: settings.bookingWindowDays,
        cutoffMinutesBefore: settings.cutoffMinutesBefore,
        cancelDeadlineMinutesBefore: settings.cancelDeadlineMinutesBefore,
        maxActiveBookingsPerFriend: settings.maxActiveBookingsPerFriend,
        approvalMode: settings.approvalMode,
        holdMinutes: settings.holdMinutes,
        slotGranularityMinutes: settings.slotGranularityMinutes,
        liffDateView: settings.liffDateView,
        reminderDayBeforeTime: settings.reminderDayBeforeTime,
        reminderHoursBefore: settings.reminderHoursBefore,
        store_photo_media_id: mediaId,
      })
      if (!response.success) throw new Error('booking_settings_save_failed')
      notifyToast(mediaId ? 'お店の写真を付けました。' : 'お店の写真を外しました。')
      onReload()
    } catch (cause) {
      setSaveError(bookingRulesErrorMessage(cause, '保存'))
    } finally {
      setSavingKey(null)
    }
  }

  async function saveMenuPhoto(menu: BookingMenu, mediaId: string | null) {
    if (!Number.isInteger(menu.version)) {
      setSaveError('メニューを読み直してから、もう一度変更してください。')
      onReload()
      return
    }
    setSavingKey(`menu:${menu.id}`)
    setSaveError(null)
    try {
      await bookingApi.updateMenu(accountId, menu.id, Number(menu.version), {
        name: menu.name,
        category_label: menu.category_label,
        description: menu.description,
        duration_minutes: menu.duration_minutes,
        buffer_after_minutes: menu.buffer_after_minutes,
        base_price: menu.base_price,
        ...(menu.price_mode ? { price_mode: menu.price_mode } : {}),
        sort_order: menu.sort_order,
        is_active: menu.is_active,
        photo_media_id: mediaId,
      })
      notifyToast(mediaId ? `「${menu.name}」の写真を付けました。` : `「${menu.name}」の写真を外しました。`)
      onReload()
    } catch (cause) {
      setSaveError(bookingErrorMessage(cause, '保存'))
    } finally {
      setSavingKey(null)
    }
  }

  async function saveStaffPhoto(person: BookingStaff, mediaId: string | null) {
    setSavingKey(`staff:${person.id}`)
    setSaveError(null)
    try {
      await bookingApi.updateStaff(accountId, person.id, { photo_media_id: mediaId })
      notifyToast(mediaId ? `「${person.display_name}」の写真を付けました。` : `「${person.display_name}」の写真を外しました。`)
      onReload()
    } catch (cause) {
      setSaveError(bookingErrorMessage(cause, '保存'))
    } finally {
      setSavingKey(null)
    }
  }

  function saveTarget(target: PickerTarget, mediaId: string | null) {
    if (target.scope === 'store') return saveStorePhoto(mediaId)
    if (target.scope === 'menu') {
      const menu = menus.find((item) => item.id === target.id)
      if (!menu) {
        setSaveError('メニューを読み直してから、もう一度変更してください。')
        onReload()
        return Promise.resolve()
      }
      return saveMenuPhoto(menu, mediaId)
    }
    const person = staff.find((item) => item.id === target.id)
    if (!person) {
      setSaveError('担当スタッフを読み直してから、もう一度変更してください。')
      onReload()
      return Promise.resolve()
    }
    return saveStaffPhoto(person, mediaId)
  }

  return (
    <div data-design="Photos">
      {!canEditAny ? (
        <Notice tone="info" message="閲覧のみです。写真の変更には予約設定の権限が必要です。" />
      ) : null}
      {saveError ? (
        <Notice tone="danger" message={saveError} onClose={() => setSaveError(null)} />
      ) : null}

      <section className={styles.section} aria-label="お店の写真">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>お店の写真</h2>
        </div>
        {settingsStatus === 'loading' || !settings ? (
          <ListState kind="loading" title="お店の写真を読み込んでいます" />
        ) : settingsStatus === 'error' ? (
          <ListState
            kind="error"
            title="お店の写真を読み込めませんでした"
            description={settingsError ?? '通信状態を確認して、もう一度お試しください。'}
            onRetry={onReload}
          />
        ) : (
          <PhotoSlot
            name="お店"
            photoUrl={settings.store_photo_url ?? null}
            canEdit={canEditSettings}
            saving={savingKey === 'store'}
            onChoose={() => setPicker({ scope: 'store' })}
            onClear={() => void saveStorePhoto(null)}
          />
        )}
      </section>

      <section className={styles.section} aria-label="メニューの写真">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>メニューの写真</h2>
        </div>
        {menusStatus === 'loading' ? (
          <ListState kind="loading" title="メニューを読み込んでいます" />
        ) : menusStatus === 'error' ? (
          <ListState
            kind="error"
            title="メニューを読み込めませんでした"
            description={menusError ?? '通信状態を確認して、もう一度お試しください。'}
            onRetry={onReload}
          />
        ) : menus.length === 0 ? (
          <ListState kind="empty" title="メニューがまだありません" description="メニュータブで作ると、ここに写真を付けられます。" />
        ) : (
          <ul className={photoStyles.rows}>
            {menus.map((menu) => (
              <li key={menu.id} className={photoStyles.row}>
                <span className={photoStyles.rowName}>{menu.name}</span>
                <PhotoSlot
                  name={menu.name}
                  photoUrl={menu.photo_url ?? null}
                  canEdit={canEditMenus}
                  saving={savingKey === `menu:${menu.id}`}
                  onChoose={() => setPicker({ scope: 'menu', id: menu.id, name: menu.name, version: menu.version })}
                  onClear={() => void saveMenuPhoto(menu, null)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-label="スタッフの写真">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>スタッフの写真</h2>
        </div>
        {staffStatus === 'loading' ? (
          <ListState kind="loading" title="担当スタッフを読み込んでいます" />
        ) : staffStatus === 'error' ? (
          <ListState
            kind="error"
            title="担当スタッフを読み込めませんでした"
            description={staffError ?? '通信状態を確認して、もう一度お試しください。'}
            onRetry={onReload}
          />
        ) : staff.length === 0 ? (
          <ListState kind="empty" title="担当スタッフがまだいません" description="担当スタッフタブで登録すると、ここに写真を付けられます。" />
        ) : (
          <ul className={photoStyles.rows}>
            {staff.map((person) => (
              <li key={person.id} className={photoStyles.row}>
                <span className={photoStyles.rowName}>{person.display_name}</span>
                <PhotoSlot
                  name={person.display_name}
                  photoUrl={person.photo_url ?? null}
                  canEdit={canEditSettings}
                  saving={savingKey === `staff:${person.id}`}
                  onChoose={() => setPicker({ scope: 'staff', id: person.id, name: person.display_name })}
                  onClear={() => void saveStaffPhoto(person, null)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <MediaPickerDialog
        open={picker !== null}
        accountId={accountId}
        kind="image"
        title={picker ? `「${targetName(picker, settings)}」の写真を選ぶ` : '写真を選ぶ'}
        onClose={() => setPicker(null)}
        onSelect={(item: MediaItem) => {
          const target = picker
          setPicker(null)
          if (target) void saveTarget(target, item.id)
        }}
      />
    </div>
  )
}
