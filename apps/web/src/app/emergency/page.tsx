'use client'
import React, { Suspense } from 'react'
import EmergencyScreen from '@/v8/settings/emergency/screen'
import EmergencyControlV8 from '../../v8/emergency/control'

function EmergencyPage() {
  return <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
    <EmergencyScreen renderControl={(accounts, controlRef) => <EmergencyControlV8 ref={controlRef} accounts={accounts} />} />
  </Suspense>
}
export default EmergencyPage
