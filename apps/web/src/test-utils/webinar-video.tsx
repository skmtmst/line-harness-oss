import { useCallback, useMemo, useState } from 'react'
import type { Webinar, WebinarEditor } from '@/lib/api'
import { VideoPane } from '@/v8/webinar-edit/public/video/index'
import Button from '@/components/shared/button'
import { webinarEditContext, webinarWizardChrome } from './webinar-edit'

const noop = () => {}

/** 現役の動画の段と、親と同じ保存の受け口を使う。 */
export default function WebinarVideoTestPane({ initialWebinar, initialEditor, readOnly = false, onDirtyChange = noop }: { initialWebinar: Webinar; initialEditor: WebinarEditor; readOnly?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [webinar, setWebinar] = useState(initialWebinar)
  const [editor, setEditor] = useState(initialEditor)
  const [save, setSave] = useState<(() => Promise<boolean>) | null>(null)
  const register = useCallback((handler: (() => Promise<boolean>) | null) => { setSave(() => handler) }, [])
  const ctx = useMemo(() => webinarEditContext(webinar, editor, { readOnly, onWebinarSaved: setWebinar, onEditorChange: setEditor }), [webinar, editor, readOnly])
  return <VideoPane ctx={ctx} chrome={{ ...webinarWizardChrome, footerActions: <Button disabled={save === null} onClick={() => void save?.()}>下書きを保存</Button> }} onDirtyChange={onDirtyChange} registerSave={register} />
}
