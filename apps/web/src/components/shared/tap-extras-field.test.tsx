// @vitest-environment happy-dom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import TapExtrasField from './tap-extras-field'
afterEach(cleanup)
it('入口の形を指定しない呼び出しは従来の文字ボタンと同じDOMを保つ',()=>{
 for(const extra of [{},{value:{scoreChange:1}},{readOnly:true},{unavailable:'選べません'}]){
  const props={name:'案内',onChange:()=>{},accountId:null,...extra}
  expect(renderToStaticMarkup(<TapExtrasField {...props}/>)).toBe(renderToStaticMarkup(<TapExtrasField {...props} addButtonVariant="text"/>))
 }
})
it('カードの枠付き入口でも開く・値を変える・外すを保つ',()=>{
 const onChange=vi.fn();render(<TapExtrasField name="案内" onChange={onChange} accountId={null} addButtonVariant="secondary"/>)
 const add=screen.getByRole('button',{name:'押されたときにあわせて行うことを足す'});expect(add.getAttribute('data-variant')).toBe('secondary');fireEvent.click(add)
 fireEvent.change(screen.getByLabelText('案内の足すスコア'),{target:{value:'3'}});expect(onChange).toHaveBeenLastCalledWith({scoreChange:3})
 fireEvent.click(screen.getByRole('button',{name:'案内の追加処理を外す'}));expect(onChange).toHaveBeenLastCalledWith({tagIds:[],scoreChange:null})
 expect(screen.getByRole('button',{name:'押されたときにあわせて行うことを足す'})).toBeTruthy()
})

it('入口の文言を指定しても開く・外すを保ち、未指定の入口には影響しない',()=>{
 render(<TapExtrasField name="クーポン" accountId={null} onChange={()=>{}} actionLabel="タグ・スコア"/>)
 fireEvent.click(screen.getByRole('button',{name:'タグ・スコアを足す'}))
 expect(screen.getByLabelText('クーポンの足すスコア')).toBeTruthy()
 expect(screen.getByRole('group',{name:'クーポンのタグ・スコア'})).toBeTruthy()
 expect(screen.queryByText('押されたときに、あわせて行うこと')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'クーポンの追加処理を外す'}))
 expect(screen.getByRole('button',{name:'タグ・スコアを足す'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'押されたときにあわせて行うことを足す'})).toBeNull()
})
