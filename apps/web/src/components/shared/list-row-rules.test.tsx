// @vitest-environment happy-dom
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

describe('一覧の行の決まり（/193/194/195/198）', () => {
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
  it.each(['停止中', '確認用', '人気の特典', '版 3'])('KPIの言葉「%s」は札へ移し、数字の位置に空の—を並べない', (text) => {
    render(<KpiCard title="状態" value={null} valueText={text} unit="" detail={null} />)
    expect(document.querySelector('[data-kpi-number]')).toBeNull()
    expect(document.querySelector('[data-design-node="xRvDB"]')?.textContent).toBe(text)
  })
  it.each(['0', '1,234 人', '¥29,800', '12.4%', '1時間24分', '+3 件', '3.2 GB', '800 KB', '—', '9.8 → 9.2 kg', '3→4通目', '0→0件', 'v3'])('数字の書式「%s」を保つ', (text) => {
    expect(isKpiNumberText(text)).toBe(true)
    render(<KpiCard title="数字" value={null} valueText={text} unit="" detail={null} />)
    expect(document.querySelector('[data-kpi-number]')?.textContent).toBe(text)
  })
  it.each(['停止中', '3→', '→4', '3→4→5', '3件の失敗'])('数ではない「%s」を大きな数にせず、空の「—」も並べずに札だけで出す', (text) => {
    expect(isKpiNumberText(text)).toBe(false)
    render(<KpiCard title="状態" value={null} valueText={text} unit="" detail={null} />)
    expect(document.querySelector('[data-kpi-number]')).toBeNull()
    expect(screen.getByText(text)).toBeTruthy()
    expect(document.body.textContent).not.toContain('—')
  })
  it.each(['v2.6.4', '2.6.4', 'v3'])('版の番号「%s」は値として数の場所に出す', (text) => {
    expect(isKpiNumberText(text)).toBe(true)
    render(<KpiCard title="いまの版" value={null} valueText={text} unit="" detail={null} />)
    expect(document.querySelector('[data-kpi-number]')?.textContent).toBe(text)
  })
  it('+Nの幅を先に確保し、全件が入れば+Nを出さない', () => {
    expect(fittingTagCount([80, 80, 80], 300, 8, () => 40)).toBe(3)
    expect(fittingTagCount([80, 80, 80], 220, 8, () => 40)).toBe(2)
    expect(fittingTagCount([80, 80, 80], 100, 8, () => 40)).toBe(0)
  })
  it.each([undefined, 2])('長い先頭を残し、残り13件と全14件の名前を区別して読める（上限%s）', async (maxVisible) => {
    vi.stubGlobal('ResizeObserver', undefined)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.tagName === 'BUTTON' ? 40 : 300, height: 24, top: 0, bottom: 24 } as DOMRect
    })
    const names = ['とても長い先頭のタグの名前', ...Array.from({ length: 13 }, (_, index) => `分類${index + 2}`)]
    const { container } = render(<TagOverflow maxVisible={maxVisible}>{names.map(name => <TagPill key={name} name={name} />)}</TagOverflow>)
    await act(async () => { await Promise.resolve() })
    const first = container.querySelector('[data-tag-overflow] > span:not([aria-hidden])')
    expect(first?.textContent).toBe(names[0])
    expect(first?.getAttribute('title')).toBe(names[0])
    fireEvent.click(screen.getByRole('button', { name: 'すべてのタグ（ほか13件）' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('group')).toHaveLength(14)
    for (const name of names) expect(within(dialog).getByText(name)).toBeTruthy()
  })
  it('幅0の器は従来どおり全件を隠し、1件だけの長いタグは省略して残す', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    let available = 0
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 24, top: 0, bottom: 24 } as DOMRect)
    const { container } = render(<TagOverflow><TagPill name="とても長い先頭のタグの名前" /></TagOverflow>)
    await act(async () => { await Promise.resolve() })
    expect(container.querySelectorAll('[data-tag-overflow] > span:not([aria-hidden])')).toHaveLength(0)
    available = 100
    await act(async () => { window.dispatchEvent(new Event('resize')); await Promise.resolve() })
    expect(container.querySelectorAll('[data-tag-overflow] > span:not([aria-hidden])')).toHaveLength(1)
    expect(container.querySelector('[data-tag-overflow-first]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /すべてのタグ/ })).toBeNull()
  })
  it('+Nを押すと全件が見え、タグを外す操作も残る', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {}; unobserve() {}; disconnect() {} })
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
  it('名前の横の未完の注記を名前の状態と混同しない', () => {
    expect(auditListSource('<Tr><NameCell name="フォーム" annotation={<StatusBadge tone="danger">後処理の未完 2</StatusBadge>} /></Tr>')).toEqual([])
    expect(auditListSource('<Tr><NameCell name={<StatusBadge>公開中</StatusBadge>} /></Tr>')).toHaveLength(1)
  })
  it.each(['重なり 1', '失敗 2'])('状態欄の「%s」は残し、名前へ状態を戻すと見張りが止める', (note) => {
    expect(auditListSource(`<Tr><NameCell name="名前" /><Td><StatusBadge>有効</StatusBadge><StatusBadge>${note}</StatusBadge></Td></Tr>`)).toEqual([])
    const broken = `<Tr><Td className={styles.colName}><FolderDotName>名前</FolderDotName><StatusBadge>有効</StatusBadge><StatusBadge>${note}</StatusBadge></Td></Tr>`
    expect(auditListSource(broken).some(rule => rule.includes('B-194'))).toBe(true)
  })
  it('タグ名の見張りを共通ブラウザ検査から外すと止める', () => {
    const entry = readFileSync(resolve(process.cwd(), 'scripts/v8-guard/owner-rules.test.mjs'), 'utf8')
    const ast = ts.createSourceFile('owner-rules.test.mjs', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const imports = ast.statements.filter(ts.isImportDeclaration).map(node => ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '')
    expect(imports).toContain('./list-row-tag-first.test.mjs')
  })
  it('全画面のソースに違反がない', () => {
    expect(auditListSources(resolve(process.cwd(), 'src'))).toEqual([])
  }, 30_000)
})
