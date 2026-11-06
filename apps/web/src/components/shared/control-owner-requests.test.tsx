// @vitest-environment happy-dom
import React from 'react'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import SearchField from './search-field'
import PageSizeSelect from './page-size-select'
import {ArchiveFilterChip} from './filter-chip'
import {TextField} from './text-field'
import {RowActions} from './row-actions'
afterEach(cleanup)
it('検索幅は印と入力を含む外枠へ渡し、入力動作を保つ',()=>{
 const change=vi.fn();render(<SearchField aria-label="注文を検索" width={360} style={{color:'red'}} value="" updateMode="immediate" onChange={change} placeholder="注文番号やお客さまの名前で検索"/> )
 const input=screen.getByRole('searchbox') as HTMLInputElement
 expect(input.parentElement?.style.width).toBe('360px');expect(input.style.width).toBe('');expect(input.style.color).toBe('red');fireEvent.change(input,{target:{value:'山田'}});expect(change).toHaveBeenCalledWith('山田')
})
it('件数選択は可視ラベルを重ねず、読み上げ名と選択を保つ',()=>{
 const change=vi.fn();const {container}=render(<PageSizeSelect value={20} onChange={change} label="表示件数"/>)
 expect(container.textContent).toBe('20件表示');fireEvent.click(screen.getByRole('button',{name:'表示件数'}));fireEvent.click(screen.getByRole('option',{name:'50件表示'}).querySelector('button')!);expect(change).toHaveBeenCalledWith(50)
})
it('保管済み切り替えの共通文言と状態を保つ',()=>{
 const change=vi.fn();render(<ArchiveFilterChip selected={false} onChange={change}/>);fireEvent.click(screen.getByRole('button',{name:'保管したものを見る'}));expect(change).toHaveBeenCalledWith(true)
})
it('計算値だけを明示的な読み取り専用欄にする',()=>{
 const {rerender}=render(<TextField aria-label="合計" derived value="123"/>);expect((screen.getByRole('textbox') as HTMLInputElement).readOnly).toBe(true);expect(screen.getByRole('textbox').dataset.look).toBe('derived')
 rerender(<TextField aria-label="合計" defaultValue="123"/>);expect((screen.getByRole('textbox') as HTMLInputElement).readOnly).toBe(false)
})
it('主操作1つを残し、詳細・編集はメニューから使える',()=>{
 const approve=vi.fn(),detail=vi.fn();render(<RowActions subjectName="申請" primary={{label:'承認する',onClick:approve}} detail={{onClick:detail}} edit={{onClick:vi.fn()}}/> )
 fireEvent.click(screen.getByRole('button',{name:'承認する'}));expect(approve).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'詳細'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'申請のその他操作'}));fireEvent.click(screen.getByRole('menuitem',{name:'詳細'}));expect(detail).toHaveBeenCalledOnce()
})
