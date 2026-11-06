type Subscriber = { active: boolean; notify: (entries: readonly ResizeObserverEntry[]) => void }

const targets = new Map<Element, Set<Subscriber>>()
const fallback = new Set<Subscriber>()
let observer: ResizeObserver | null = null

function notifyFallback() {
  for (const subscriber of [...fallback]) if (subscriber.active) subscriber.notify([])
}

/** One delivery schedules every target before measurement microtasks can commit. */
export function observeElementResize(elements: readonly Element[], notify: Subscriber['notify']): () => void {
  const unique = new Set(elements)
  if (!unique.size) return () => {}
  const subscriber: Subscriber = { active: true, notify }
  if (typeof ResizeObserver === 'undefined') {
    if (!fallback.size && typeof window !== 'undefined') window.addEventListener('resize', notifyFallback)
    fallback.add(subscriber)
    return () => {
      if (!subscriber.active) return
      subscriber.active = false
      fallback.delete(subscriber)
      if (!fallback.size && typeof window !== 'undefined') window.removeEventListener('resize', notifyFallback)
    }
  }
  if (!observer) {
    const current = new ResizeObserver((entries) => {
      if (observer !== current) return
      const deliveries = new Map<Subscriber, ResizeObserverEntry[]>()
      for (const entry of entries) for (const listener of targets.get(entry.target) ?? []) {
        const group = deliveries.get(listener) ?? []
        group.push(entry)
        deliveries.set(listener, group)
      }
      for (const [listener, group] of deliveries) if (listener.active) listener.notify(group)
    })
    observer = current
  }
  for (const element of unique) {
    let listeners = targets.get(element)
    if (!listeners) {
      listeners = new Set()
      targets.set(element, listeners)
      observer.observe(element)
    }
    listeners.add(subscriber)
  }
  return () => {
    if (!subscriber.active) return
    subscriber.active = false
    for (const element of unique) {
      const listeners = targets.get(element)
      listeners?.delete(subscriber)
      if (listeners && !listeners.size) {
        targets.delete(element)
        observer?.unobserve(element)
      }
    }
    if (!targets.size) { observer?.disconnect(); observer = null }
  }
}
