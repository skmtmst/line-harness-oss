'use client'

import {
api
} from '@/lib/api'
import { type Group } from './create-types'


type ReloadMenuGroupContext = {
  hydrate: (g: Group) => void
}

export async function reloadMenuGroup({ hydrate }: ReloadMenuGroupContext, groupId: string) {
    const res = await api.richMenuGroups.get(groupId)
    if (!res.success) throw new Error(res.error ?? '取得失敗')
    hydrate(res.data as Group)
  }
