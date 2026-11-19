// At most a few inline terminals at once, held only by tails on screen with output; the rest wait in claim order.

import { useEffect, useSyncExternalStore } from 'react'

export const NATIVE_CHAT_LIVE_TAIL_SLOTS = 3

const claims: string[] = []
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Whether this row holds a slot; it claims one only while `wants` (a visible tail with output to show). */
export function useNativeChatLiveTailSlot(claimKey: string, wants: boolean): boolean {
  useEffect(() => {
    if (!wants) {
      return
    }
    claims.push(claimKey)
    publish()
    return () => {
      const index = claims.indexOf(claimKey)
      if (index !== -1) {
        claims.splice(index, 1)
        publish()
      }
    }
  }, [claimKey, wants])
  const read = () => {
    const index = claims.indexOf(claimKey)
    return index !== -1 && index < NATIVE_CHAT_LIVE_TAIL_SLOTS
  }
  return useSyncExternalStore(subscribe, read, read)
}
