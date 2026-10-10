// @vitest-environment happy-dom
import {afterEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import HqMessageBody,{HQ_FRIEND_INSERTS} from './hq-message-inserts'
import {fromApiContent,toApiContent} from '@/v8/hq-broadcasts/model'
afterEach(cleanup)
test('店の3種類・LINEの名前と基本8種類。飲食と店独自の欄は出さない',()=>{
 const change=vi.fn();render(<HqMessageBody value="" onChange={change}/>);fireEvent.click(screen.getByRole('button',{name:'店名'}));expect(change).toHaveBeenCalledWith('{{account.name}}');
 fireEvent.click(screen.getByRole('button',{name:'友だち情報'}));expect(screen.getAllByRole('menuitem')).toHaveLength(8);fireEvent.click(screen.getByRole('menuitem',{name:'アレルギー'}));expect(change).toHaveBeenCalledWith('{{field.fixed_allergy}}');expect(screen.queryByText('記念日')).toBeNull();
 for(const item of HQ_FRIEND_INSERTS)expect(fromApiContent(toApiContent(item.label))).toBe(item.label)
})
test('閲覧のみは差し込みを押せない物ごと隠す',()=>{render(<HqMessageBody value="{{name}}" readOnly onChange={()=>{}}/>);expect(screen.queryByRole('button')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull()})
