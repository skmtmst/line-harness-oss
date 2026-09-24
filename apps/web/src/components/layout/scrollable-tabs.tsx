'use client'

import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Button from '../shared/button'
import { Tabs, type TabItem } from '../shared/tabs'

/**
 * タブが右にはみ出す画面向けの、横スクロールできるタブ行（U091）。
 *
 * 共通の `Tabs` は「はみ出し」のふるまいを持たない。狭い画面では右の
 * タブが見えず、深いURLへ直接入ると選択中のタブ自体が画面外になる。
 * ここでは部品の見た目を変えず、外側に次の3つを足す。
 *
 * - はみ出すときだけ横スクロール（中の nav を w-max に広げて送れる幅を作る）
 * - 選択中のタブを表示位置へ寄せる
 * - 端に隠れている側へ送るボタン（その側にまだ項目があるときだけ出す）
 *
 * キーボードでタブへ移ったときも、そのタブが見える位置までスクロールする。
 */
export default function ScrollableTabs({
  items,
  actions,
  label,
}: {
  items: TabItem[]
  actions?: ReactNode
  /** タブの並び全体を読み上げる名前（Issue #708）。 */
  label?: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const currentIndex = items.findIndex((item) => item.current)

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    updateEdges()
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateEdges])

  /*
   * 選択中のタブが変わったら（深いURLで開いた初回を含む）、そのタブが
   * 見える位置へ寄せる。押すたびではなく「変わったとき」だけ動かす。
   * items は描画ごとに新しい配列なので、中身の「どれが選ばれたか」だけ見る。
   */
  useEffect(() => {
    const el = scrollerRef.current
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !current) return
    const target = current.offsetLeft - 16
    el.scrollTo({ left: Math.max(0, target) })
    updateEdges()
  }, [currentIndex, updateEdges])

  /** フォーカスが外に出たタブへ移っても、指だけでなく見た目も追いつかせる。 */
  const keepFocusVisible = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  const scrollByEdge = (direction: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.6), behavior: 'smooth' })
  }

  /*
   * className はすべて静的リテラルにする（design-debt の「読めない
   * className」を増やさない）。外の余白は使う側の枠が持つ。
   */
  return (
    <div className="flex min-w-0 flex-wrap items-stretch" data-scrollable-tabs>
      {canLeft ? (
        <span className="flex shrink-0 items-center border-b border-hairline px-1">
          <Button
            className="w-7 px-0"
            aria-label="左側のタブを表示"
            onClick={() => scrollByEdge(-1)}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
        </span>
      ) : null}
      {/*
        #707: 390pxで4つ目以降のタブが隠れても手がかりが薄い。
        隠れている側の端に薄い影を置き、続きがあることを見せる
        （送りボタンと連動し、収まるときは何も出さない）。
      */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollerRef}
          className="overflow-x-auto"
          onScroll={updateEdges}
          onFocus={keepFocusVisible}
        >
          {/*
            中のタブ行（shared Tabs の nav）を中身の幅まで広げる。
            これが無いと nav は容器の幅のままでタブ列が見えないまま
            はみ出し、スクロールしても右のタブへ届かない。
            中身が収まるときは min-w-full で従来どおり全幅に敷く。
          */}
          <Tabs items={items} className="w-max min-w-full" label={label} />
        </div>
        {canLeft ? (
          <span
            aria-hidden="true"
            data-scroll-hint="left"
            className="pointer-events-none absolute inset-y-0 left-0 w-6"
            style={{ background: 'linear-gradient(to right, var(--color-canvas), transparent)' }}
          />
        ) : null}
        {canRight ? (
          <span
            aria-hidden="true"
            data-scroll-hint="right"
            className="pointer-events-none absolute inset-y-0 right-0 w-6"
            style={{ background: 'linear-gradient(to left, var(--color-canvas), transparent)' }}
          />
        ) : null}
      </div>
      {/*
        右端の操作はスクロール領域へ入れない。入れると「人を追加する」の
        ような主操作が初期位置から見えなくなる（タブだけを送る）。
        見た目は shared/tabs の `.actions` と同じ帯に揃える。
      */}
      {actions ? (
        <span className="flex shrink-0 items-center gap-2 border-b border-hairline pb-1 pl-3 max-sm:order-last max-sm:basis-full max-sm:justify-end max-sm:border-b-0 max-sm:pl-0 max-sm:pt-2">{actions}</span>
      ) : null}
      {canRight ? (
        <span className="flex shrink-0 items-center border-b border-hairline px-1">
          <Button
            className="w-7 px-0"
            aria-label="右側のタブを表示"
            onClick={() => scrollByEdge(1)}
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </span>
      ) : null}
    </div>
  )
}
