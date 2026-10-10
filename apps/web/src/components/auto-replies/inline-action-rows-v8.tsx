'use client'

import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { ActionConfigEditor, ACTION_KINDS } from '@/components/scenarios/action-editor'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { DragHandle, MoreAction, useReorder } from '@/components/shared/row-actions'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { actionIncompleteReason } from './action-completeness'
import { newActionKey, type InlineAction } from './draft-fields'
import type { ActionOptions } from './inline-action-list'
import styles from './inline-action-rows-v8.module.css'
import { SaveErrorField } from '@/components/shared/save-form-errors'


// 既存の入口。B-178の持ち主はshared/action-rows（画面の見た目はここに書かない）。

export {
    default,actionRowTitle} from '@/components/shared/action-rows'
