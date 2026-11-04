import { useEffect, useState } from 'react'

/** 見本からの作成指示を一度だけ受け取り、店舗切替後に再実行しない。 */
export function useInitialWebhookSource(requested: string, presets: readonly { value: string }[]): string {
  const [source] = useState(() => {
    const current = typeof window === 'undefined' ? requested : new URL(window.location.href).searchParams.get('source') ?? ''
    return presets.some(preset => preset.value === current) ? current : ''
  })
  useEffect(() => {
    if (!source) return
    const url = new URL(window.location.href)
    url.searchParams.delete('source')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [source])
  return source
}
