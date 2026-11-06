// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net=vi.hoisted(()=>({details:vi.fn()}))
vi.mock('next/link',()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}))
vi.mock('@/lib/api/helpers/styles',()=>({hqStyleApi:{catalogDetails:net.details}}))
import { CatalogDetails } from './catalog-details'
afterEach(cleanup)
it('配置の番号と行き先を対応させ、固定した版のカタログ編集へ案内する',async()=>{
  const selection={kind:'rich_menu' as const,templateId:'menu',versionId:'version'}
  net.details.mockResolvedValue({data:{...selection,name:'メニュー',version:2,lines:[],pages:[{name:'ページ1',width:100,height:50,areas:[
    {label:'予約',destination:'URL：https://example.com/reserve',x:0,y:0,width:50,height:50},
    {label:'回答フォーム',destination:'回答フォーム：お問い合わせ',x:50,y:0,width:50,height:50},
  ]}]}})
  render(<CatalogDetails selection={selection} onClose={()=>{}}/> )
  await screen.findByRole('heading',{name:'メニュー（版2）'})
  const rows=screen.getAllByRole('listitem')
  expect(within(rows[0]).getByText('1. 予約')).toBeTruthy()
  expect(within(rows[0]).getByText('URL：https://example.com/reserve')).toBeTruthy()
  expect(within(rows[1]).getByText('2. 回答フォーム')).toBeTruthy()
  expect(within(rows[1]).getByText('回答フォーム：お問い合わせ')).toBeTruthy()
  expect(screen.getByRole('link',{name:'カタログを編集する'}).getAttribute('href')).toBe('/hq/rich-menus?mode=edit&item=menu')
  expect(screen.queryByRole('button',{name:'保存する'})).toBeNull()
})
