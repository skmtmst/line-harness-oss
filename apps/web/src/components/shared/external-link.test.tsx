// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import Button from './button'
import TextLink from './text-link'
afterEach(cleanup)
it.each([Button,TextLink])('external は新しいタブ・noreferrer・外への印をまとめて付ける',(Component)=>{
 render(<Component href="https://example.com" external target="_self" rel="opener">原文を開く</Component>)
 const a=screen.getByRole('link',{name:'原文を開く'});expect(a.getAttribute('target')).toBe('_blank');expect(a.getAttribute('rel')?.split(/\s+/)).toContain('noreferrer');expect(a.querySelector('[data-external-icon]')).toBeTruthy()
})
it.each([Button,TextLink])('普通の画面遷移は同じタブ',(Component)=>{
 render(<Component href="/friends">友だちを見る</Component>);expect(screen.getByRole('link').getAttribute('target')).toBeNull();expect(screen.getByRole('link').querySelector('[data-external-icon]')).toBeNull()
})
