import { useCallback, useMemo, useState } from 'react'
import type { Webinar, WebinarEditor } from '@/lib/api'
import { NotificationsPane } from '@/v8/webinar-edit/public/notifications/index'
import Button from '@/components/shared/button'
import { webinarEditContext, webinarWizardChrome } from './webinar-edit'

const noop = () => {}
const defaultEditor = { version: 2 } as WebinarEditor

/** 現役の通知の段に、製品の親と同じ保存の受け口と帯を渡す。 */
export default function WebinarNotificationsTestPane({ webinarId, editor = defaultEditor }: { webinarId: string; editor?: WebinarEditor }) {
  const [save, setSave] = useState<(() => Promise<boolean>) | null>(null)
  const register = useCallback((handler: (() => Promise<boolean>) | null) => { setSave(() => handler) }, [])
  const ctx = useMemo(() => webinarEditContext({ id: webinarId, title: 'NEN活用スタートセミナー' } as Webinar, editor), [webinarId, editor])
  return <NotificationsPane ctx={ctx} chrome={{ ...webinarWizardChrome, footerActions: <Button disabled={save === null} onClick={() => void save?.()}>下書きを保存</Button> }} onDirtyChange={noop} registerSave={register} />
}
