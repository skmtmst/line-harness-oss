// @vitest-environment happy-dom
import React from 'react'
import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import TextLink from './text-link'
afterEach(cleanup)
it('本文の中のリンクは矢印を付けず、緑の文字の印を持つ',()=>{
 render(<p>お忘れの方は<TextLink inline href="/password/forgot">こちら</TextLink></p>)
 const a=screen.getByRole('link',{name:'こちら'});expect(a.hasAttribute('data-inline')).toBe(true);expect(a.querySelector('svg')).toBeNull()
})
it('本文の中でも外へのリンクは新しいタブ・noreferrer のまま',()=>{
 render(<TextLink inline external href="https://example.com">手引き</TextLink>)
 const a=screen.getByRole('link',{name:'手引き'});expect(a.getAttribute('target')).toBe('_blank');expect(a.getAttribute('rel')?.split(/\s+/)).toContain('noreferrer')
})
it('普通のリンクは矢印を付け、本文の中の印は持たない',()=>{
 render(<TextLink href="/friends">友だちを見る</TextLink>)
 const a=screen.getByRole('link');expect(a.hasAttribute('data-inline')).toBe(false);expect(a.querySelector('svg')).toBeTruthy()
})
