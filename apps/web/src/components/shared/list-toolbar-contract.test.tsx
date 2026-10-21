// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ListToolbar, { ListToolbarFrame, ListToolbarLeading, ListToolbarRow, ListToolbarSearchSlot, ListToolbarEnd, ListToolbarSort } from './list-toolbar'
import PageSizeSelect from './page-size-select'
import Select from './select'
import HelpTip from './help-tip'
import SearchField from './search-field'
import { ListPage } from '@/components/templates/list-page'

afterEach(cleanup)

it('型へ渡した道具の断片と操作説明をまとめ、検索・選択・件数の受け口を保つ', async () => {
  const search = vi.fn(), filter = vi.fn(), size = vi.fn()
  const { container } = render(<ListToolbarLeading leading={null} accessory={<HelpTip label="一覧の操作の説明">元の保存条件を説明します。</HelpTip>}><><>
    <p>種類を変える前の注意を残します。</p>
    <ListToolbarSearchSlot><input aria-label="項目名で探す" onChange={search} /></ListToolbarSearchSlot>
    <span><Select aria-label="種類" value="all" onChange={filter} width={119} options={[{ value: 'all', label: '種類：すべて' }, { value: 'date', label: '種類：日付' }]} /></span>
    <span aria-hidden="true" />
    <PageSizeSelect value={20} onChange={size} label={null} />
  </></></ListToolbarLeading>)
  expect(container.querySelectorAll('[data-toolbar-layout="slots"]')).toHaveLength(1)
  const tools = container.querySelector('[data-toolbar-layout="slots"]')!
  const notice = screen.getByText('種類を変える前の注意を残します。')
  expect(tools.contains(notice)).toBe(false)
  expect(notice.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('textbox').closest('[data-toolbar-role="search"]')).toBeTruthy()
  expect(screen.getByRole('button', { name: '表示件数' }).closest('[data-toolbar-role="count"]')).toBeTruthy()
  expect(screen.getByRole('button', { name: '種類' }).parentElement!.style.width).toBe('')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '日付' } })
  expect(search).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '種類' }))
  fireEvent.click(screen.getByRole('option', { name: '日付' }).querySelector('button')!)
  expect(filter).toHaveBeenCalledWith('date')
  fireEvent.click(screen.getByRole('button', { name: '表示件数' }))
  fireEvent.click(screen.getByRole('option', { name: /50/ }).querySelector('button')!)
  expect(size).toHaveBeenCalledWith(50)
  fireEvent.click(screen.getByRole('button', { name: '一覧の操作の説明' }))
  expect((await screen.findByRole('note')).textContent).toContain('元の保存条件')
})

it('nested Frame and Toolbar render the leading actions once and keep their handler', () => {
  const create = vi.fn()
  render(<ListToolbarLeading leading={<button onClick={create}>作る</button>}><ListToolbarFrame><ListToolbar search={{ placeholder: '探す', value: '', onChange: vi.fn() }} /></ListToolbarFrame></ListToolbarLeading>)
  expect(screen.getAllByRole('button', { name: '作る' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '作る' }))
  expect(create).toHaveBeenCalledOnce()
})

it('入れ子の断片の順が変わっても、入力した値を別の操作へ移さない', () => {
  const fields = (order: string[]) => <ListToolbarLeading leading={null}><>{order.map(name => <React.Fragment key={name}>
    <ListToolbarRow><input aria-label={name} defaultValue={name} /></ListToolbarRow>
  </React.Fragment>)}</></ListToolbarLeading>
  const { rerender } = render(fields(['条件名', 'メモ']))
  fireEvent.change(screen.getByRole('textbox', { name: '条件名' }), { target: { value: '入力を保持' } })
  rerender(fields(['メモ', '条件名']))
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '条件名' }).value).toBe('入力を保持')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'メモ' }).value).toBe('メモ')
})

it('畳んだフォルダにも同じ実幅の口を使い、作成とフォルダ選択を保つ', () => {
  const create = vi.fn(), folder = vi.fn()
  render(<ListToolbarLeading leading={<>
    <button onClick={create}>項目を作る</button>
    <span><Select aria-label="フォルダ" value="all" width={150} onChange={folder} options={[{ value: 'all', label: 'フォルダ：すべて' }, { value: 'shop', label: 'フォルダ：通販' }]} /></span>
  </>}><ListToolbar search={{ placeholder: '項目名で探す', value: '', onChange: vi.fn() }} /></ListToolbarLeading>)
  expect(screen.getByRole('button', { name: 'フォルダ' }).parentElement!.style.width).toBe('')
  expect(screen.getAllByRole('button', { name: '項目を作る' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '項目を作る' }))
  expect(create).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(screen.getByRole('option', { name: '通販' }).querySelector('button')!)
  expect(folder).toHaveBeenCalledWith('shop')
})

it('the shared end orders sort before page size while preserving selection', () => {
  const change = vi.fn()
  const { container } = render(<ListToolbarEnd><PageSizeSelect value={20} onChange={change} /><ListToolbarSort value="new" onChange={vi.fn()} options={[{ value: 'new', label: '新しい順' }]} /></ListToolbarEnd>)
  const buttons = [...container.querySelectorAll('button[aria-haspopup="listbox"]')]
  expect(buttons.map(el => el.getAttribute('aria-label'))).toEqual(['並び', '表示件数'])
  fireEvent.click(screen.getByRole('button', { name: '表示件数' }))
  fireEvent.click(screen.getByRole('option', { name: /50/ }).querySelector('button')!)
  expect(change).toHaveBeenCalledWith(50)
})

describe('共通の道具の段の操作', () => {
  it('検索の変更と消す操作を元の受け口へ返す', async () => {
    const onChange = vi.fn()
    render(<ListToolbar search={{ placeholder: '名前を探す', label: '一覧を検索', value: '来店', onChange }} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '一覧を検索' }), { target: { value: '予約' } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('予約'))
    fireEvent.click(screen.getByRole('button', { name: /消/ }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('保存した条件の操作を2段目の口へ渡し、元のイベントを保つ', () => {
    const useCondition = vi.fn()
    render(<ListToolbar search={{ placeholder: '探す', value: '', onChange: vi.fn() }} actions={<button onClick={useCondition}>保存した条件</button>} />)
    const action = screen.getByRole('button', { name: '保存した条件' })
    expect(action.closest('[data-toolbar-actions]')).toBeTruthy()
    fireEvent.click(action)
    expect(useCondition).toHaveBeenCalledOnce()
  })

  it('読み上げ名が省略されたときは探す欄の説明を使う', () => {
    render(<ListToolbar search={{ placeholder: '名前・本文を探す', value: '', onChange: vi.fn() }} />)
    expect(screen.getByRole('searchbox', { name: '名前・本文を探す' })).toBeTruthy()
  })

  it('検索がない一覧でも絞り込みと件数を操作できる', () => {
    const filter = vi.fn(), size = vi.fn()
    render(<ListToolbar filters={<button onClick={filter}>予約のみ</button>} trailing={<select aria-label="表示件数" onChange={size}><option>20件</option><option>50件</option></select>} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '予約のみ' }))
    fireEvent.change(screen.getByRole('combobox', { name: '表示件数' }), { target: { value: '50件' } })
    expect(filter).toHaveBeenCalledOnce()
    expect(size).toHaveBeenCalledOnce()
  })

  it('字ラベルを省略した表示件数も共通の件数の役目として右端へ渡す', () => {
    render(<ListToolbarRow><button>よく使う絞り込み</button><PageSizeSelect label={null} value={20} onChange={vi.fn()} /></ListToolbarRow>)
    const count = screen.getByRole('button', { name: '表示件数' })
    expect(count.closest('[data-toolbar-role="count"]')).toBeTruthy()
    expect(count.closest('[data-toolbar-role="filter"]')).toBeNull()
  })

  it('断片の道具も型の口でまとめ、作る・検索・件数の役目とフォーム送信を保つ', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(<ListToolbarLeading leading={<button>タグを作る</button>}><>
      <ListToolbarSearchSlot><input aria-label="タグを探す" /></ListToolbarSearchSlot>
      <ListToolbarRow as="form" onSubmit={submit}><PageSizeSelect label={null} value={20} onChange={vi.fn()} /><button type="submit">検索する</button></ListToolbarRow>
    </></ListToolbarLeading>)
    const search = screen.getByRole('textbox', { name: 'タグを探す' })
    expect(search.closest('[data-toolbar-role="search"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: '表示件数' }).closest('[data-toolbar-role="count"]')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'タグを作る' })).toHaveLength(1)
    fireEvent.submit(screen.getByRole('button', { name: '検索する' }).closest('form')!)
    expect(submit).toHaveBeenCalledOnce()
  })

  it('入れ子の断片に既存の道具の型があれば二重に包まず、作る操作を保つ', () => {
    const { container } = render(<ListToolbarLeading leading={<button>流入リンクを作る</button>}><><>
      <ListToolbar search={{ placeholder: '流入元を探す', value: '', onChange: vi.fn() }} />
    </></></ListToolbarLeading>)
    expect(container.querySelectorAll('[data-toolbar-layout="band"]')).toHaveLength(1)
    expect(container.querySelector('[data-toolbar-layout="slots"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: '流入リンクを作る' })).toHaveLength(1)
  })

  it('フォームを共通の段へ移しても検索の送信と条件操作を保つ', () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault()), filter = vi.fn()
    render(<ListToolbarFrame><ListToolbarRow as="form" onSubmit={submit}>
      <ListToolbarSearchSlot><input aria-label="検索" defaultValue="来店" /></ListToolbarSearchSlot>
      <button type="submit">検索する</button>
      <ListToolbarEnd><button type="button" onClick={filter}>詳細条件</button></ListToolbarEnd>
    </ListToolbarRow></ListToolbarFrame>)
    fireEvent.submit(screen.getByRole('textbox', { name: '検索' }).closest('form')!)
    fireEvent.click(screen.getByRole('button', { name: '詳細条件' }))
    expect(submit).toHaveBeenCalledOnce()
    expect(filter).toHaveBeenCalledOnce()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '検索' }).value).toBe('来店')
  })

  it('2段目の状態切り替えも操作を保つ', () => {
    const onClick = vi.fn()
    render(<ListToolbar secondary={<button onClick={onClick}>注目のみ</button>} />)
    fireEvent.click(screen.getByRole('button', { name: '注目のみ' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

it('並びは道具の段の共通欄だけで選ぶ', () => {
  const html = renderToStaticMarkup(<ListToolbar search={{ placeholder: '探す', value: '', onChange: vi.fn() }} sort={{ value: 'recent', onChange: vi.fn(), options: [{ value: 'recent', label: '新しい順' }] }} />)
  expect(html).toContain('data-list-sort')
  expect(html).toContain('aria-label="並び"')
})

it('U4：並びの現在値を表示し、選んだ順序を元の受け口へ返す', () => {
  const change = vi.fn()
  render(<ListToolbarSort aria-label="並び順" value="newest" options={[{ value: 'newest', label: '新しい順' }, { value: 'name', label: '名前順' }]} onChange={change} />)
  const trigger = screen.getByRole('button', { name: '並び' })
  expect(trigger.textContent).toContain('並び：新しい順')
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: '名前順' }).querySelector('button')!)
  expect(change).toHaveBeenCalledWith('name')
})
it('U4：並びの候補が無ければ空の欄を置かない', () => {
  const change = vi.fn()
  const { container } = render(<ListToolbarSort value="" options={[]} onChange={change} />)
  expect(container.querySelector('button')).toBeNull()
  expect(change).not.toHaveBeenCalled()
})


it.each([false, true])('単独の検索を渡した一覧も、畳む先へフォルダと許可された作成を渡す（閲覧のみ=%s）', readOnly => {
  const create = vi.fn(), folder = vi.fn(), search = vi.fn()
  const { container } = render(<ListPage title="自動応答" readOnly={readOnly} folders={<nav>広い画面のフォルダ</nav>}
    folderNav={{ rows: [{ id: 'all', label: 'すべて' }, { id: 'other', label: '予約' }], activeId: 'all', onSelect: folder,
      createAction: readOnly ? undefined : <button onClick={create}>ひな形を作る</button> }}
    toolbar={<SearchField aria-label="ひな形を検索" placeholder="ひな形を探す" value="" updateMode="immediate" onChange={search} />}>一覧の内容</ListPage>)
  const leading = container.querySelector<HTMLElement>('[data-toolbar-leading]')
  expect(leading).toBeTruthy()
  const tools = leading!.closest('[data-list-toolbar]')!
  expect(tools.contains(screen.getByRole('searchbox', { name: 'ひな形を検索' }))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(screen.getByRole('option', { name: '予約' }).querySelector('button')!)
  expect(folder).toHaveBeenCalledWith('other')
  fireEvent.change(screen.getByRole('searchbox', { name: 'ひな形を検索' }), { target: { value: '来店' } })
  expect(search).toHaveBeenCalledWith('来店')
  if (readOnly) expect(screen.queryByRole('button', { name: 'ひな形を作る' })).toBeNull()
  else {
    fireEvent.click(screen.getByRole('button', { name: 'ひな形を作る' }))
    expect(create).toHaveBeenCalledOnce()
  }
})
