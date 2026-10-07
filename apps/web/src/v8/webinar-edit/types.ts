import type { ReactNode } from 'react'
import type { Webinar, WebinarAnalytics, WebinarCtaCard, WebinarEditor } from '@/lib/api'
import type { PaneKey } from './helpers'

/** 各段が親（edit.tsx）から受け取るもの。 */
export type EditContext = {
  webinar: Webinar
  editor: WebinarEditor
  /** 変える権限が無い（staff）。変える操作は置かずに隠す。 */
  readOnly: boolean
  publicUrl: string | null
  canOpenPublicPage: boolean
  publicPageReason: string
  ctaCount: number
  analytics: WebinarAnalytics | null
  analyticsState: 'idle' | 'loading' | 'ready' | 'error'
  onEditorChange: (editor: WebinarEditor) => void
  onWebinarSaved: (webinar: Webinar) => void
  onCtasReport: (ctas: WebinarCtaCard[] | null) => void
  onPublished: () => void
  goStep: (pane: PaneKey) => void
  retryAnalytics: () => void
}

/** 作る型（CreatePage）に渡す頭と下の帯。 */
export type WizardChrome = {
  title: string
  identity: ReactNode
  steps: ReactNode
  footerActions: ReactNode
  status?: ReactNode
}

/** 詳細の頭（題・説明・タブ）。 */
export type DetailChrome = {
  title: string
  subtitle: string
  participantsCount: number | null
  onSelect: (pane: PaneKey) => void
}

export type PaneSaveProps = {
  onDirtyChange: (dirty: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
}
