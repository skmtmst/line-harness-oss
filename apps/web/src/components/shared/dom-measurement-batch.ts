// Measure all mounted controls before any measurement changes their DOM.
// A microtask keeps the work in the current turn, without a timer or extra frame.
const pending = new Map<object, () => () => void>()
let queued = false

export function scheduleMeasurement(key: object, read: () => () => void) {
  pending.set(key, read)
  if (queued) return
  queued = true
  queueMicrotask(() => {
    queued = false
    const reads = [...pending.values()]
    pending.clear()
    const commits = reads.map(read => read())
    for (const commit of commits) commit()
  })
}

export function cancelMeasurement(key: object) {
  pending.delete(key)
}
