// @vitest-environment happy-dom
/*
 * 窓の上に開いた引き出し・窓は、後ろに回らず前に出る（共通の Dialog・Drawer・準備中の窓）。
 * 画面ごとに z-index を書かず、開いた順に番号を持つ。
 */
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'
import PreparingDialog from './preparing-dialog'

afterEach(cleanup)

const layerOf = (name: string) => {
  const panel = screen.getByRole('dialog', { name })
  return Number((panel.closest('[role="presentation"]') as HTMLElement).style.zIndex)
}

function DialogThenDrawer() {
  const [drawer, setDrawer] = useState(false)
  return <>
    <Dialog open title="顧客情報" onCancel={() => {}}><button type="button" onClick={() => setDrawer(true)}>引き出しを開く</button></Dialog>
    <Drawer open={drawer} title="配信の受け取り" onClose={() => setDrawer(false)} />
  </>
}

function DrawerThenDialog() {
  const [dialog, setDialog] = useState(false)
  return <>
    <Drawer open title="引き出し" onClose={() => {}}><button type="button" onClick={() => setDialog(true)}>窓を開く</button></Drawer>
    <Dialog open={dialog} title="確かめの窓" onCancel={() => setDialog(false)} />
  </>
}

describe('後から開いた窓・引き出しが前に出る', () => {
  it('窓の上に開いた引き出しは、窓より前', async () => {
    render(<DialogThenDrawer />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '引き出しを開く' })) })
    expect(layerOf('配信の受け取り')).toBeGreaterThan(layerOf('顧客情報'))
  })
  it('引き出しの上に開いた窓は、引き出しより前', async () => {
    render(<DrawerThenDialog />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '窓を開く' })) })
    expect(layerOf('確かめの窓')).toBeGreaterThan(layerOf('引き出し'))
  })
  it('窓の上に出した準備中の窓は、窓より前', async () => {
    function Both() {
      const [on, setOn] = useState(false)
      return <><Dialog open title="詳細条件" onCancel={() => {}}><button type="button" onClick={() => setOn(true)}>準備中を開く</button></Dialog><PreparingDialog open={on} feature="来店の回数での絞り込み" onClose={() => setOn(false)} /></>
    }
    render(<Both />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '準備中を開く' })) })
    expect(layerOf('現在準備中です')).toBeGreaterThan(layerOf('詳細条件'))
  })
})
