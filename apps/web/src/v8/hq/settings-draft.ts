import type { Ref } from 'react'

export type SettingsDraft = { dirty: boolean; save: () => Promise<boolean>; reset: () => void }
export type SettingsDraftProps = { draftRef?: Ref<SettingsDraft>; onDirtyChange?: (dirty: boolean) => void; locked?: boolean }
