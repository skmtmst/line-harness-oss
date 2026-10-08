/*
 * 遅い応答・失敗の試験（監査 WEB190 ほか）で使う小さな道具。
 * 画面を1つ描き、応答を好きな順で返せるようにする。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export interface Mounted {
  host: HTMLDivElement
  render: (node: React.ReactNode) => Promise<void>
  unmount: () => Promise<void>
}

export function mount(): Mounted {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  return {
    host,
    render: async (node) => { await act(async () => { root.render(node) }) },
    unmount: async () => {
      await act(async () => { root.unmount() })
      host.remove()
    },
  }
}

/** 約束と時計を何度か回して、画面の書き換えを落ち着かせる。 */
export async function settle(times = 15): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }
}

export function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => (button.textContent ?? '').replace(/\s+/g, ' ').includes(text))
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('押す対象が無い')
  await act(async () => { (el as HTMLElement).click() })
}

/** 試験で触らない API は、外へ出ずに「見つからない」を返す。 */
export function stubFetchNotFound(): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: 'not found' }), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  }))
}
