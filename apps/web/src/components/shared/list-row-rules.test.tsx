// @vitest-environment happy-dom
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { auditListSource, auditListSources } from '../../../scripts/list-row-audit.mjs'
import { NameCell } from './table'
import { RowActions } from './row-actions'
import KpiCard from './kpi-card'
import { isKpiNumberText } from './kpi-number-text'
import TagOverflow, { fittingTagCount } from './tag-overflow'
import TagPill from './tag-pill'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('一覧の行の決まり（B-190/193/194/195/198）', () => {
  it('編集は「…」から実行し、行の押下へ伝わらない。閲覧のみには出さない', () => {
    const edit = vi.fn(), row = vi.fn()
    render(<div onClick={row}><RowActions subjectName="名前" edit={{ onClick: edit }} /></div>)
    expect(screen.queryByRole('button', { name: '編集する' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '名前のその他操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
    expect(edit).toHaveBeenCalledOnce()
    expect(row).not.toHaveBeenCalled()
    cleanup()
    render(<RowActions subjectName="閲覧のみ" />)
    expect(screen.getByRole('button', { name: '閲覧のみのその他操作' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '編集する' })).toBeNull()
  })
  it('名前は丸＋名前1行。全文とフォルダ名を確認できる', () => {
    const html = renderToStaticMarkup(<table><tbody><tr><NameCell name="長い名前" folder={{ name: 'フォルダ', color: '#123456' }} /></tr></tbody></table>)
    expect(html).toContain('title="長い名前"')
    expect(html).toContain('フォルダ：フォルダ')
    expect(html.match(/data-folder-dot=/g)).toHaveLength(1)
  })
  it.each(['停止中', '確認用', '人気の特典', '版 3', 'v1.2.3'])('KPIの言葉「%s」は札へ移し、数字の位置は—にする', (text) => {
    render(<KpiCard title="状態" value={null} valueText={text} unit="" detail={null} />)
    expect(document.querySelector('[data-kpi-number]')?.textContent).toBe('—')
    expect(document.querySelector('[data-design-node="xRvDB"]')?.textContent).toBe(text)
  })
  it.each(['0', '1,234 人', '¥29,800', '12.4%', '1時間24分', '+3 件', '—'])('数字の書式「%s」を保つ', (text) => {
    expect(isKpiNumberText(text)).toBe(true)
    render(<KpiCard title="数字" value={null} valueText={text} unit="" detail={null} />)
    expect(document.querySelector('[data-kpi-number]')?.textContent).toBe(text)
  })
  it('+Nの幅を先に確保し、全件が入れば+Nを出さない', () => {
    expect(fittingTagCount([80, 80, 80], 300, 8, () => 40)).toBe(3)
    expect(fittingTagCount([80, 80, 80], 220, 8, () => 40)).toBe(2)
    expect(fittingTagCount([80, 80, 80], 100, 8, () => 40)).toBe(0)
  })
  it('+Nを押すと全件が見え、タグを外す操作も残る', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    const remove = vi.fn()
    render(<TagOverflow maxVisible={0}><TagPill name="VIP" onRemove={remove} /><TagPill name="会員" /><TagPill name="常連" /></TagOverflow>)
    fireEvent.click(screen.getByRole('button', { name: 'すべてのタグ（ほか3件）' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('VIP')).toBeTruthy()
    expect(within(dialog).getByText('会員')).toBeTruthy()
    expect(within(dialog).getByText('常連')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'VIPを外す' }))
    expect(remove).toHaveBeenCalledOnce()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    vi.unstubAllGlobals()
  })
  it('わざと壊した行の編集・名前の2行目・タグの切り捨てをソースの見張りが検出する', () => {
    const broken = '<Tr><Td className={styles.colName}><FolderDotName>名前</FolderDotName><span className={styles.refCode}>識別子</span><StatusBadge>停止中</StatusBadge></Td><Td><Button>編集する</Button></Td>{friend.tags.slice(0, 1).map(tag => <TagPill name={tag.name}/>)}</Tr>'
    const failures = auditListSource(broken)
    for (const rule of ['B-190', 'B-193', 'B-194']) expect(failures.some((failure: string) => failure.includes(rule))).toBe(true)
    expect(auditListSource('<FolderDotName><FolderDotName>名前</FolderDotName></FolderDotName>')[0]).toContain('名前の丸の重複')
    expect(auditListSource('<Tr><Td><RowMenu items={[{ label: "編集する" }]} /></Td></Tr>')).toEqual([])
  })
  it('全画面のソースに違反がない', () => {
    expect(auditListSources(resolve(process.cwd(), 'src'))).toEqual([])
  }, 30_000)
})
