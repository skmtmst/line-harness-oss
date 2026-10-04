'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Button from '@/components/shared/button'
import { AnalyticsPage, CreatePage, DashboardPage, DashboardColumns, DashboardRow, DetailPage, InboxPage, ListPage, SettingsPage } from '@/components/templates'
import packed from './reference-fixtures.json'
import styles from './preview.module.css'

type Fixture = {
  source: string; screenId: string; reference: string; shell: string; shellLeft: string; shellTop: string; height: number
  slots: Record<string, string>; heading: { title?: string; description?: string }
  rows?: Array<{ name: string; cells: string[]; styles: string[] }>
}
/** 正本 HTML の中身を props で入れ、外形だけを本物の型で組み直す確認専用ページ。
 * 実データの取得・更新は行わない。AppShell の通常の認証は維持する。 */
function Slot({ html }: { html?: string }) {
  return html ? <div className={styles.slot} dangerouslySetInnerHTML={{ __html: html }} /> : null
}
function Preview() {
  const params = useSearchParams()
  const kind = params.get('type') || 'dashboard'
  const reference = params.get('source') === 'reference'
  const capture = params.get('capture') === '1'
  const [fixtures, setFixtures] = useState<Record<string, Fixture> | null>(null)
  useEffect(() => {
    let cancelled = false
    const bytes = Uint8Array.from(atob(packed.gzip), (char) => char.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    void new Response(stream).json().then((value) => { if (!cancelled) setFixtures(value) })
    return () => { cancelled = true }
  }, [])
  const fixture = fixtures?.[kind]
  if (!fixture) return <p>型の見本を読み込んでいます。</p>
  const s = fixture.slots
  const heading = { title: fixture.heading.title ?? '', description: fixture.heading.description, identity: s.identity ? <Slot html={s.identity} /> : undefined, actions: s.actions ? <Slot html={s.actions} /> : undefined, steps: s.steps ? <Slot html={s.steps} /> : undefined }
  const common = { ...heading, standalone: true }
  const content = <Slot html={s.content} />
  let template
  switch (kind) {
    case 'dashboard': template = <DashboardPage {...common} notice={<Slot html={s.notice} />} stats={<div className={styles.horizontal}><Slot html={s.stats} /></div>}>
      {fixture.rows?.map((row, index) => index === 3
        ? <DashboardColumns key={row.name}>{row.cells.map((html) => <Slot key={html.slice(0, 40)} html={html} />)}</DashboardColumns>
        : <DashboardRow key={row.name} variant={index === 0 ? 'trend' : index === 1 ? 'inbox' : 'link'} aside={<Slot html={row.cells[1]} />}><Slot html={row.cells[0]} /></DashboardRow>)}
      <Slot html={s.tail} />
    </DashboardPage>; break
    case 'list': case 'list-folders': template = <ListPage {...common} headingSize={kind === 'list-folders' ? 'large' : 'regular'} tabs={<div className={`${styles.horizontal} ${kind === 'list-folders' ? styles.folderTabItems : styles.tabItems}`}><Slot html={s.tabs} /></div>} stats={<div className={styles.horizontal}><Slot html={s.stats} /></div>} folders={s.folders ? <Slot html={s.folders} /> : undefined} toolbar={kind === 'list' ? <div className={styles.stackedTools}><Slot html={s.toolbar} /></div> : <Slot html={s.toolbar} />} pagination={<div className={`${styles.horizontal} ${styles.paginationItems}`}><Slot html={s.pagination} /></div>}>{content}</ListPage>; break
    case 'create': template = <CreatePage {...common} preview={<Slot html={s.preview} />} previewToggle={<Button>見え方を開く</Button>} footerActions={<Button variant="primary">次へ</Button>}>{content}</CreatePage>; break
    case 'detail': template = <DetailPage {...common} tabs={<div className={`${styles.horizontal} ${styles.tabItems}`}><Slot html={s.tabs} /></div>} summary={<Slot html={s.summary} />}>{content}</DetailPage>; break
    case 'inbox': template = <InboxPage standalone list={<Slot html={s.list} />} summary={<Slot html={s.summary} />} summaryToggle={<Button>要点を開く</Button>} composer={null}><Slot html={s.conversation} /></InboxPage>; break
    case 'settings': template = <SettingsPage {...common} navigation={<Slot html={s.navigation} />} saveActions={<><Button>キャンセル</Button><Button variant="primary">変更を保存</Button></>} saveStatus="保存していない変更があります">{content}</SettingsPage>; break
    case 'analytics': template = <AnalyticsPage {...common} period={<Slot html={s.period} />} stats={<div className={styles.horizontal}><Slot html={s.stats} /></div>} aside={<Slot html={s.aside} />} asideToggle={<Button>内訳を開く</Button>}>{content}</AnalyticsPage>; break
    default: template = null
  }
  return <div className={styles.viewer} data-theme="v8" data-template-preview={kind}>
    {reference ? <div className={styles.host} dangerouslySetInnerHTML={{ __html: fixture.reference }} /> :
      <div className={styles.shell} style={{ height: fixture.height }}><Slot html={fixture.shellLeft} /><div className={styles.shellRight}><Slot html={fixture.shellTop} /><div className={styles.board}>{template}</div></div></div>}
    {!capture ? <nav aria-label="確認する型" className={styles.chooser}>{Object.keys(fixtures ?? {}).map((type) => <a key={type} href={`?type=${type}${reference ? '&source=reference' : ''}`}>{type}</a>)}<a href={`?type=${kind}${reference ? '' : '&source=reference'}`}>{reference ? '実装を見る' : '正本を見る'}</a></nav> : null}
  </div>
}
export default function V8TemplatesPage() { return <Suspense fallback={null}><Preview /></Suspense> }
