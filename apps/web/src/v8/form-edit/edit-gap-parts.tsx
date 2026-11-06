'use client'

import { type FormLayout } from '@line-crm/shared';
import { type EditTab } from './model';


/*
 * 回答フォームの編集（★V8）。板：中身 ・1152 ・予約を入れるブロック ・
 * 答え終わったあと ・受付と見た目 ・競合 ・この版を公開 。
 *
 * 作る型（CreatePage）に、上の3つのタブ・左の段・右の「回答用URL」と
 * 「お客さまに見える形」（スマホ）を載せる。データの読み書き・保存・公開・
 * 競合・試しのURLは今までの画面（app/form-submissions/edit/page.tsx）と同じ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */

const TAB_ITEMS: { key: EditTab; label: string }[] = [
  { key: 'content', label: '中身' },
  { key: 'after', label: '答え終わったあと' },
  { key: 'appearance', label: '受付と見た目' },
]


/** 板の印（撮影と見比べのため）。1152 は 。 */
const TAB_NODE: Record<EditTab, string> = { content: 'm1cWEy', after: 'XXFT4', appearance: 'tpRRT' }


type Snapshot = {
  name: string
  description: string
  isActive: boolean
  onSubmitTagId: string
  ogTitle: string
  ogDescription: string
  ogImageUrl: string
  layout: FormLayout
}
export { TAB_ITEMS, TAB_NODE, type Snapshot }
