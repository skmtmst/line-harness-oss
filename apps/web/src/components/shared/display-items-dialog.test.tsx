// @vitest-environment happy-dom
import {afterEach, expect, test, vi} from 'vitest'
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import DisplayItemsDialog from './display-items-dialog'
vi.mock('next/link',()=>({default:({children,...props}:React.ComponentProps<'a'>)=><a {...props}>{children}</a>}))
afterEach(cleanup)
const items=[{key:'a',label:'名前',group:'基本'},{key:'b',label:'アレルギー',group:'基本'},{key:'field:c',label:'ペット',group:'分類 / 犬'}]
test('上限では追加を止め、外してから検索・追加・並べ替えし、保存した順を返す',async()=>{
 const save=vi.fn();render(<DisplayItemsDialog items={items} selected={['a','b']} maxSelected={2} onCancel={()=>{}} onConfirm={save}/>);
 expect((screen.getByRole('checkbox',{name:'ペット'}) as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:'アレルギー'}));
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'犬'}});
 await waitFor(()=>expect(screen.queryByRole('checkbox',{name:'アレルギー'})).toBeNull());
 fireEvent.click(screen.getByRole('checkbox',{name:'ペット'}));
 fireEvent.keyDown(screen.getByRole('button',{name:/ペット.*並び/}),{key:'ArrowUp'});
 expect(save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'保存する'}));expect(save).toHaveBeenCalledWith(['field:c','a']);
})
test('取消では変更を送らず、欄が無い時にも管理への入口を置く',()=>{
 const save=vi.fn(),cancel=vi.fn();render(<DisplayItemsDialog items={items.slice(0,2)} selected={['a']} manageHref="/friend-fields" onCancel={cancel} onConfirm={save}/>);
 expect(screen.getByRole('link',{name:'情報欄を管理'})).toHaveProperty('href','http://localhost:3000/friend-fields');
 fireEvent.click(screen.getByRole('checkbox',{name:'アレルギー'}));fireEvent.click(screen.getByRole('button',{name:'キャンセル'}));fireEvent.click(screen.getByRole('button',{name:'破棄する'}));expect(cancel).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
})

test('開いている間に消された欄は、上限にも保存内容にも残さない',()=>{
 const save=vi.fn();const view=render(<DisplayItemsDialog items={items} selected={['a','field:c']} maxSelected={2} onCancel={()=>{}} onConfirm={save}/>);
 view.rerender(<DisplayItemsDialog items={items.slice(0,2)} selected={['a']} maxSelected={2} onCancel={()=>{}} onConfirm={save}/>);
 expect((screen.getByRole('checkbox',{name:'アレルギー'}) as HTMLInputElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'保存する'}));expect(save).toHaveBeenCalledWith(['a']);
})
