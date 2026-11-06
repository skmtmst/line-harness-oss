'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SECTION_ORDER, DETAIL_SECTIONS, DETAIL_SETTING_GROUPS, DetailSectionKey } from './friend-info-model'

export function useFriendInfoPreferences() {

  const [showSettings, setShowSettings] = useState(false)

  const [draggedGroupKey, setDraggedGroupKey] = useState<string | null>(null)

  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)

  const [settingsPanelPos, setSettingsPanelPos] = useState<{
    top?: number
    bottom?: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  /*
   * 「表示項目」パネルは、押したボタンの下へ開く(#982 LAY-03)。
   * 以前は `top:430px` 固定で、高さ700pxの画面では「初期状態に戻す」
   * 「閉じる」が画面外へ出て届かなかった。
   * 下に十分な空きがなければボタンの上へ開き、どちらにしても
   * 最大高さは 100dvh-32px（上下16px余白）までに収める。
   */
  const updateSettingsPanelPos = useCallback(() => {
    const button = settingsButtonRef.current
    if (!button || typeof window === 'undefined') return
    const rect = button.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(360, window.innerWidth - margin * 2)
    // 右端をボタンに合わせる。はみ出すときだけ左へ寄せる。
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin)
    const belowTop = rect.bottom + gap
    const belowRoom = window.innerHeight - belowTop - margin
    const aboveRoom = rect.top - gap - margin
    const capHeight = (room: number) => Math.max(100, Math.min(room, window.innerHeight - margin * 2))
    if (belowRoom >= 240 || belowRoom >= aboveRoom) {
      setSettingsPanelPos({ top: belowTop, left, width, maxHeight: capHeight(belowRoom) })
    } else {
      setSettingsPanelPos({ bottom: window.innerHeight - rect.top + gap, left, width, maxHeight: capHeight(aboveRoom) })
    }
  }, [])

  /*
   * 開いているあいだは Escape で閉じ、画面サイズやスクロールで
   * ボタンの位置が動いたら置き直す（パネルは画面基準の fixed のため
   * 追従しないとボタンから離れる）。
   */
  useEffect(() => {
    if (!showSettings) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', updateSettingsPanelPos)
    window.addEventListener('scroll', updateSettingsPanelPos, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updateSettingsPanelPos)
      window.removeEventListener('scroll', updateSettingsPanelPos, true)
    }
  }, [showSettings, updateSettingsPanelPos])

  const [sectionOrder, setSectionOrder] = useState<DetailSectionKey[]>(DEFAULT_SECTION_ORDER)

  const [hiddenSections, setHiddenSections] = useState<DetailSectionKey[]>([])


  useEffect(() => {
    try {
      const raw = localStorage.getItem('chat.friendInfoSections.v4')
      if (raw) {
        const parsed = JSON.parse(raw) as { order?: DetailSectionKey[]; hidden?: DetailSectionKey[] }
        const valid = new Set(DETAIL_SECTIONS.map((item) => item.key))
        const order = (parsed.order ?? []).filter((key) => valid.has(key))
        for (const item of DETAIL_SECTIONS) if (!order.includes(item.key)) order.push(item.key)
        setSectionOrder(order)
        setHiddenSections((parsed.hidden ?? []).filter((key) => valid.has(key)))
      }
    } catch {
      // 保存値が壊れていても既定順で使える。
    }
  }, [])

  const sectionStyle = (key: DetailSectionKey) => ({ order: sectionOrder.indexOf(key) })


  const moveGroup = (groupKey: string, delta: -1 | 1) => {
    setSectionOrder((current) => {
      const groups = [...DETAIL_SETTING_GROUPS].sort((a, b) => {
        const aIndex = Math.min(...a.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        const bIndex = Math.min(...b.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        return aIndex - bIndex
      })
      const index = groups.findIndex((group) => group.key === groupKey)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= groups.length) return current
        ;[groups[index], groups[nextIndex]] = [groups[nextIndex], groups[index]]
      return groups.flatMap((group) => group.sections)
    })
  }

  const moveGroupBefore = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return
    setSectionOrder((current) => {
      const groups = [...DETAIL_SETTING_GROUPS].sort((a, b) => {
        const aIndex = Math.min(...a.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        const bIndex = Math.min(...b.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        return aIndex - bIndex
      })
      const sourceIndex = groups.findIndex((group) => group.key === sourceKey)
      if (sourceIndex < 0) return current
      const [source] = groups.splice(sourceIndex, 1)
      const targetIndex = groups.findIndex((group) => group.key === targetKey)
      if (targetIndex < 0) return current
      groups.splice(targetIndex, 0, source)
      return groups.flatMap((group) => group.sections)
    })
  }

  const orderedSettingGroups = [...DETAIL_SETTING_GROUPS].sort((a, b) => {
    const aIndex = Math.min(...a.sections.map((key) => sectionOrder.indexOf(key)).filter((index) => index >= 0))
    const bIndex = Math.min(...b.sections.map((key) => sectionOrder.indexOf(key)).filter((index) => index >= 0))
    return aIndex - bIndex
  })
  return { showSettings, setShowSettings, draggedGroupKey, setDraggedGroupKey, settingsPanelPos, setSectionOrder, hiddenSections, setHiddenSections, sectionStyle, moveGroup, moveGroupBefore, orderedSettingGroups }
}
