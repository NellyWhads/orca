// Which command's output each chat pane shows in place of its conversation; session-only, never persisted.

import { useCallback, useSyncExternalStore } from 'react'

/** The open command, its row's words, and the subagent whose view opened it (null: the main conversation), which Back returns to. */
export type NativeChatOpenCommand = { taskId: string; label: string; returnTo: string | null }

const openByPane = new Map<string, NativeChatOpenCommand>()
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

/** `paneKey` is the chat's status pane key; null closes the command view. */
export function openNativeChatCommand(paneKey: string, open: NativeChatOpenCommand | null): void {
  const current = openByPane.get(paneKey)
  if (current?.taskId === open?.taskId && current?.returnTo === open?.returnTo) {
    return
  }
  if (open === null) {
    openByPane.delete(paneKey)
  } else {
    openByPane.set(paneKey, open)
  }
  publish()
}

export function closeNativeChatCommand(paneKey: string): void {
  openNativeChatCommand(paneKey, null)
}

/** A closed or replaced chat tab takes its panes' open commands with it. */
export function retireNativeChatCommandViews(tabId: string): void {
  let retired = false
  for (const paneKey of openByPane.keys()) {
    if (paneKey.startsWith(`${tabId}:`)) {
      openByPane.delete(paneKey)
      retired = true
    }
  }
  if (retired) {
    publish()
  }
}

export function isNativeChatCommandOpen(paneKey: string): boolean {
  return openByPane.has(paneKey)
}

export function useNativeChatOpenCommand(paneKey: string): NativeChatOpenCommand | null {
  const read = useCallback(() => openByPane.get(paneKey) ?? null, [paneKey])
  return useSyncExternalStore(subscribe, read, read)
}
