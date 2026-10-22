'use client'
import { useLayoutEffect, useRef } from 'react'
import { cancelMeasurement, scheduleMeasurement } from './dom-measurement-batch'
import { calendarInterval } from './calendar-time-range'

type Interval = { start: string; end: string }
const px = (value: string) => Number.parseFloat(value) || 0

/** Scale the complete time axis instead of extending short controls over their neighbours. */
export function useCalendarTimeScale(entries: readonly Interval[], free: readonly Interval[], canWrite: boolean) {
  const host = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const intervals = [...entries, ...(canWrite ? free : [])].flatMap(slot => { const interval = calendarInterval(slot); return interval ? [interval.end - interval.start] : [] })
    if (!intervals.length) return
    const minimum = Math.min(...intervals)
    const property = '--tpl-sd-week-hour'
    const original = element.style.getPropertyValue(property), priority = element.style.getPropertyPriority(property)
    let baseHour: number | null = null
    let active = true
    const key = {}
    const read = () => {
      if (!active) return () => {}
      const css = getComputedStyle(element)
      baseHour ??= px(css.getPropertyValue(property))
      const gap = px(css.getPropertyValue('--tpl-sd-entry-gap'))
      const samples = [element.querySelector<HTMLElement>('button[data-placement="calendar"]:not([data-calendar-slot])'), element.querySelector<HTMLElement>('button[data-calendar-slot]')]
      const required = Math.max(0, ...samples.filter((sample): sample is HTMLElement => Boolean(sample)).map(button => {
        const style = getComputedStyle(button)
        const heights = [...button.children].map(child => (child as HTMLElement).scrollHeight || child.getBoundingClientRect().height)
        const content = style.flexDirection === 'column' ? heights.reduce((sum, height) => sum + height, 0) + Math.max(0, heights.length - 1) * px(style.rowGap) : Math.max(0, ...heights)
        return content + px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth)
      }))
      const hour = Math.max(baseHour, Math.ceil((required + gap) * 60 / minimum))
      return () => {
        if (!active || !baseHour || !required) return
        if (hour > baseHour) element.style.setProperty(property, `${hour}px`)
        else if (original) element.style.setProperty(property, original, priority)
        else element.style.removeProperty(property)
      }
    }
    const update = () => { if (active) scheduleMeasurement(key, read) }
    update()
    window.addEventListener('resize', update)
    const fonts = document.fonts
    if (fonts?.status === 'loading') void fonts.ready.then(update)
    fonts?.addEventListener('loadingdone', update)
    return () => {
      active = false; cancelMeasurement(key)
      window.removeEventListener('resize', update)
      fonts?.removeEventListener('loadingdone', update)
      if (original) element.style.setProperty(property, original, priority)
      else element.style.removeProperty(property)
    }
  }, [entries, free, canWrite])
  return host
}
