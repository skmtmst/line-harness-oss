// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import Toggle from './toggle'
import {SettingCheckbox} from './checkbox'
afterEach(cleanup)
it('保存で反映する設定はチェック、即時反映の操作はスイッチ',()=>{
 const draft=vi.fn(),now=vi.fn();render(<><SettingCheckbox label="通知する" checked={false} onChange={draft}/><Toggle label="公開する" checked={true} onChange={now}/></>)
 fireEvent.click(screen.getByRole('checkbox',{name:'通知する'}));expect(draft).toHaveBeenCalledWith(true);expect(now).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('switch',{name:'公開する'}));expect(now).toHaveBeenCalledWith(false)
})
it('固定の必須設定はオンのまま変更できない',()=>{
 const change=vi.fn();render(<SettingCheckbox label="必ず短縮する" checked={false} locked onChange={change}/>);const check=screen.getByRole('checkbox') as HTMLInputElement;expect(check.checked).toBe(true);expect(check.disabled).toBe(true);fireEvent.click(check);expect(change).not.toHaveBeenCalled()
})
