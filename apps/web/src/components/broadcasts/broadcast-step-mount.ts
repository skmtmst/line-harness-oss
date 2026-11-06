'use client'

import { useState } from 'react'

/** Defer an unvisited step, then keep its inputs mounted when it is hidden. */
export function useBroadcastStepVisited(active: boolean): boolean {
  const [visited, setVisited] = useState(active)
  // Update during this render so a newly active step exists before focus effects.
  if (active && !visited) setVisited(true)
  return active || visited
}
