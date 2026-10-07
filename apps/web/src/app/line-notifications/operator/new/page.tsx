'use client'

import NewOperatorNotificationV8 from '@/v8/line-notifications/operator-edit'

/*
 * 板 gjUz3（作る）・hiBO8（?id= でなおす）：V8だけで作る。v7 の作成画面は完全切替
 * （2026-10-04 オーナー）で捨てた。2026-10-07 から画面は src/v8/line-notifications/operator-edit
 * （データの口・下書き保存・公開・テスト送信・版の守りは operator-new-v8 から写した）。
 */
export default function NewOperatorNotificationPage() {
  return <NewOperatorNotificationV8 />
}
