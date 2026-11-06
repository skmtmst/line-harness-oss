import type { Webinar, WebinarEditor } from '@/lib/api'
import type { DetailChrome, EditContext, WizardChrome } from '@/v8/webinar-edit/public/types/index'
import { vi } from 'vitest'

/** 単独の段も、製品の編集画面と同じ受け口で描く。記録したい口は呼ぶ側で上書きする。 */
export function webinarEditContext(webinar: Webinar, editor: WebinarEditor, overrides: Partial<EditContext> = {}): EditContext {
  return {
    webinar, editor, readOnly: false,
    publicUrl: null, canOpenPublicPage: false, publicPageReason: '公開してから確認できます。',
    ctaCount: 0, analytics: null, analyticsState: 'idle',
    onEditorChange: vi.fn(), onWebinarSaved: vi.fn(), onCtasReport: vi.fn(), onPublished: vi.fn(),
    goStep: vi.fn(), retryAnalytics: vi.fn(), ...overrides,
  }
}

export const webinarWizardChrome: WizardChrome = {
  title: 'ウェビナーの編集', identity: null, steps: null, footerActions: null,
}

export const webinarDetailChrome: DetailChrome = {
  title: 'ウェビナーの詳細', subtitle: '参加者・分析・コメント演出', participantsCount: null, onSelect: vi.fn(),
}
