'use client'

import { type RichMenuAreaIntent } from '@line-crm/shared'

export type Area = {
  id: string
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
  /**
   * LINE に登録するときの動きの種類。intent から決まる。
   * datetimepicker・clipboard は新しい2種。DB へは postback に載るが、
   * 画面が送る段階では intent から決めた本来の種類を載せる。
   */
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch' | 'datetimepicker' | 'clipboard'
  actionData: Record<string, unknown>
  /** 運用者から見た「何をするボタンか」。 */
  intent?: RichMenuAreaIntent | null
  /** 管理用のボタン名。 */
  label?: string | null
  /** 押されたときに付けるタグ。 */
  tagIds?: string[]
  /** 押されたときに足すスコア。 */
  scoreChange?: number | null
  templateId?: string | null
  formId?: string | null
  trackedLinkId?: string | null
}
