'use client'

/*
 * 回答フォームの一覧（板 `I3L41O`）。V8 だけで書く。
 * 本体は `@/v8/forms/list`（データの口・窓・検証はあちら。動きは BEHAVIOR.md）。
 * 今までの `./list-v8` は動きの試験が読むので残す（切り替えの日に消す）。
 */
import FormsListV8 from '@/v8/forms/list'

export default function FormSubmissionsPage() {
  return <FormsListV8 />
}
