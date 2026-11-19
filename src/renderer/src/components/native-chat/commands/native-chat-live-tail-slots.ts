// At most a few inline live terminals at once: several subagents can each run a command, and every tail is an
// xterm plus a poll. Rows claim in mount order; a row past the cap waits and takes a slot when one frees.

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

/** Whether this row holds one of the live-tail slots; `claimKey` must be unique to the mounted row. */
export function useNativeChatLiveTailSlot(claimKey: string): boolean {
  useEffect(() => {
    claims.push(claimKey)
    publish()
    return () => {
      const index = claims.indexOf(claimKey)
      if (index !== -1) {
        claims.splice(index, 1)
        publish()
      }
    }
  }, [claimKey])
  const read = () => {
    const index = claims.indexOf(claimKey)
    return index !== -1 && index < NATIVE_CHAT_LIVE_TAIL_SLOTS
  }
  return useSyncExternalStore(subscribe, read, read)
}
