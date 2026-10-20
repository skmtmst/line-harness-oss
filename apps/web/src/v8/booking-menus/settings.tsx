'use client'
import { useBookingSettings } from './use-booking-settings'
export { useBookingSettings } from './use-booking-settings'

import { useMemo } from 'react'

import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import BookingSettingsView from './settings-view'
import { LiffPhoneMenuStep, LiffPhoneDatetimeStep, LiffPhoneStaffStep } from './settings-parts'

export default function BookingSettingsV8({ accountId }: { accountId: string | null }) {
  const model = useBookingSettings(accountId)
  const { tab, menus, menusStatus, previewMenu, staff, designationFree, staffStatus, preview, closedWeekdays, phoneView } = model
  const phone = useMemo(() => {
    if (tab === 'menus') return <LiffPhoneMenuStep menus={menus} status={menusStatus} />
    if (tab === 'staff') return <LiffPhoneStaffStep menu={previewMenu} staff={staff} designationFree={designationFree} status={staffStatus} />
    return <LiffPhoneDatetimeStep menu={previewMenu} staffName={preview.staffName} slots={preview.slots}
      closedDates={preview.closedDates} closedWeekdays={closedWeekdays} view={phoneView} status={preview.status} />
  }, [tab, menus, menusStatus, previewMenu, staff, designationFree, staffStatus, preview, closedWeekdays, phoneView])
  return <>
    <BookingSettingsView {...model} phone={phone} />
    <UnsavedLeaveDialog open={model.leaveTarget !== null} subject={model.tabEdit?.subject ?? '変更'}
      onConfirm={model.confirmLeave} onCancel={model.cancelLeave} />
  </>
}
