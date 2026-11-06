import type { Option } from './action-option-types'
'use client'
import type { ActionTargetOption } from '../scenarios/action-editor'

export interface ActionOptions {
  templates?: ActionTargetOption[]
  reminders?: ActionTargetOption[]
  events?: ActionTargetOption[]
  targetsLoading?: boolean
  targetsError?: string
  retryTargets?: () => void
  notificationRules?: Array<Option & {version:number}>
  tags: Option[]
  fields: Option[]
  marks: Option[]
  scenarios: Option[]
  vars: { varKey: string; name: string }[]
}
