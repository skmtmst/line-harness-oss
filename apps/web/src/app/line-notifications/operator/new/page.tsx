'use client'

import NewOperatorNotificationV8 from './operator-new-v8'

/*
 * 板 gjUz3：V8だけで作る。v7 の作成画面は完全切替（2026-10-04 オーナー）で
 * 捨てた。データの口・下書き保存・公開・テスト送信・版の守りは
 * operator-new-v8 がそのまま持っている。
 */
export default function NewOperatorNotificationPage() {
  return <NewOperatorNotificationV8 />
}
