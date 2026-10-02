'use client'

import { useEffect, useState } from 'react'
import type { ReleaseEntry } from '@/lib/update-client'

export type UpdateStatus =
  | { kind: 'loading' }
  | { kind: 'latest'; version: string }
  | { kind: 'fork'; reason: string; version: string }
  | { kind: 'upgrade'; current: string; target: ReleaseEntry }

const updateBannerEnabled = process.env.NEXT_PUBLIC_UPDATE_BANNER_ENABLED !== 'false'

// inject-version を通さないビルド (自前 CI/CD やローカル dev) のバージョン placeholder。
// この場合「manifest に無い」のは当たり前なので fork 警告バナーは出さない。
export const DEV_VERSION = '0.0.0-dev'

export const MANUAL_UPDATE_GUIDE_URL =
  'https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md'

/**
 * 今の版と更新状態を返す（新しい版あり／カスタマイズ版／最新）。
 * 上の版の帯と、左メニューの下の「Ver.」行（v8・夕12 ZT5kI）で分かち合う。
 */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'loading' })

  useEffect(() => {
    // visual-qa は Pencil と同じ画面状態だけを撮る。運用環境向けの告知は
    // 撮影器が付ける一時印で外し、通常利用時の表示条件は変えない。
    try {
      if (window.sessionStorage.getItem('lh_visual_qa_capture') === '1') return
    } catch {
      // ストレージを使えない環境では通常の表示判定を続ける。
    }
    if (!updateBannerEnabled) return

    let cancelled = false
    ;(async () => {
      try {
        // update-client は NEXT_PUBLIC_API_URL 未設定だと読み込み時点で落ちる
        // （試験・静的解析など）。ここは通知の発射台なので遅延で読む。
        const { getCurrentVersion, getManifest, detectFork, findLatestUpgrade } =
          await import('@/lib/update-client')
        if (cancelled) return
        const current = await getCurrentVersion()
        if (cancelled) return
        // バージョン未埋め込みビルドでは manifest 照合自体が無意味なので
        // バナーを出さない (自前デプロイ運用では正常な状態)。
        if (current.version === DEV_VERSION) return
        const manifest = await getManifest()
        if (cancelled) return
        const fork = detectFork(current, manifest)
        if (fork.kind === 'fork') {
          setStatus({
            kind: 'fork',
            reason: fork.reason,
            version: current.version,
          })
          return
        }
        const upgrade = findLatestUpgrade(manifest, current.version)
        if (!upgrade) {
          setStatus({ kind: 'latest', version: current.version })
        } else {
          setStatus({
            kind: 'upgrade',
            current: current.version,
            target: upgrade,
          })
        }
      } catch (e) {
        // Banner is best-effort: do not break the dashboard if /admin/version
        // or the Worker-hosted manifest proxy is unreachable. Phase 9 will add a
        // visible error chip; for Phase 6 we just stay in `loading` (null).
        console.error('update banner failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
