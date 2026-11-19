// Each foreground tail's stream outlives its row, so a row the list remounts comes back at the same height and content.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import {
  NATIVE_CHAT_COMMAND_ANNOUNCE_TIMEOUT_MS,
  readNativeChatCommandOutputChunk,
  startCommandOutputPoll,
  type NativeChatCommandOutputSink,
  type NativeChatCommandOutputStatus,
  type PollProgress
} from './native-chat-command-output-poll'

// Most commands finish before Claude Code announces a task (about 5 s in); they never cost a read.
const FIRST_READ_DELAY_MS = 2000
// What a remounted tail replays: far more than its rows show, bounded per command.
const BUFFER_MAX_CHARS = 64 * 1024
const MAX_ENTRIES = 48

export type NativeChatCommandTailSnapshot = {
  status: NativeChatCommandOutputStatus
  /** Some output arrived; the row keeps its tail's height from then on. */
  hasOutput: boolean
}

type TailEntry = {
  key: string
  progress: PollProgress
  snapshot: NativeChatCommandTailSnapshot
  buffer: string
  createdAt: number
  activeConsumers: number
  stop: (() => void) | null
  terminals: Set<NativeChatCommandOutputSink>
  listeners: Set<() => void>
  read: (offset: number) => ReturnType<typeof readNativeChatCommandOutputChunk>
}

const entries = new Map<string, TailEntry>()
const WAITING: NativeChatCommandTailSnapshot = { status: 'waiting', hasOutput: false }

function notify(entry: TailEntry): void {
  for (const listener of entry.listeners) {
    listener()
  }
}

function report(entry: TailEntry, next: Partial<NativeChatCommandTailSnapshot>): void {
  const snapshot = { ...entry.snapshot, ...next }
  if (
    snapshot.status !== entry.snapshot.status ||
    snapshot.hasOutput !== entry.snapshot.hasOutput
  ) {
    entry.snapshot = snapshot
    notify(entry)
  }
}

/** Keep a bounded tail of what streamed, cut at a line start so a replay never opens mid escape sequence. */
function appendBounded(buffer: string, text: string): string {
  const next = buffer + text
  if (next.length <= BUFFER_MAX_CHARS) {
    return next
  }
  const cut = next.indexOf('\n', next.length - BUFFER_MAX_CHARS)
  return cut === -1 ? '' : next.slice(cut + 1)
}

function entrySink(entry: TailEntry): NativeChatCommandOutputSink {
  return {
    write: (text) => {
      entry.buffer = appendBounded(entry.buffer, text)
      for (const terminal of entry.terminals) {
        terminal.write(text)
      }
    },
    reset: () => {
      entry.buffer = ''
      for (const terminal of entry.terminals) {
        terminal.reset()
      }
    }
  }
}

function evictIdle(): void {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_ENTRIES) {
      return
    }
    if (entry.activeConsumers === 0 && entry.terminals.size === 0 && entry.listeners.size === 0) {
      entries.delete(key)
    }
  }
}

function tailEntry(target: RuntimeClientTarget, sessionId: string, toolUseId: string): TailEntry {
  const key = `${target.kind === 'local' ? 'local' : target.environmentId}|${sessionId}|${toolUseId}`
  const existing = entries.get(key)
  if (existing) {
    return existing
  }
  const entry: TailEntry = {
    key,
    progress: { key, sink: null, offset: 0, settled: false },
    snapshot: WAITING,
    buffer: '',
    createdAt: Date.now(),
    activeConsumers: 0,
    stop: null,
    terminals: new Set(),
    listeners: new Set(),
    read: (offset) => readNativeChatCommandOutputChunk(target, sessionId, { toolUseId }, offset)
  }
  entries.set(key, entry)
  evictIdle()
  return entry
}

function startPolling(entry: TailEntry): void {
  if (entry.stop || entry.progress.settled) {
    return
  }
  entry.stop = startCommandOutputPoll({
    read: entry.read,
    progress: entry.progress,
    sink: entrySink(entry),
    pendingTimeoutMs: NATIVE_CHAT_COMMAND_ANNOUNCE_TIMEOUT_MS,
    pendingSince: entry.createdAt,
    initialDelayMs:
      entry.progress.offset === 0
        ? Math.max(0, FIRST_READ_DELAY_MS - (Date.now() - entry.createdAt))
        : 0,
    report: (polled) => {
      if (polled.status !== undefined && polled.status !== 'live' && polled.status !== 'waiting') {
        entry.stop = null
      }
      report(entry, {
        ...(polled.status !== undefined ? { status: polled.status } : {}),
        ...(polled.status === 'live' ? { hasOutput: true } : {})
      })
    }
  })
}

function stopPolling(entry: TailEntry): void {
  entry.stop?.()
  entry.stop = null
}

/** A running call's tail state; it polls only while `active` (its layer shown, it on screen, the window visible). */
export function useNativeChatCommandTail(input: {
  target: RuntimeClientTarget
  sessionId: string
  toolUseId: string
  active: boolean
}): {
  snapshot: NativeChatCommandTailSnapshot
  attach: (terminal: NativeChatCommandOutputSink) => () => void
} {
  const { target, sessionId, toolUseId, active } = input
  const entry = tailEntry(target, sessionId, toolUseId)
  const entryRef = useRef(entry)
  useLayoutEffect(() => {
    entryRef.current = entry
  })
  const snapshot = useSyncExternalStore(
    (listener) => {
      entry.listeners.add(listener)
      return () => entry.listeners.delete(listener)
    },
    () => entry.snapshot,
    () => entry.snapshot
  )
  useEffect(() => {
    if (!active) {
      return
    }
    entry.activeConsumers += 1
    startPolling(entry)
    return () => {
      entry.activeConsumers -= 1
      if (entry.activeConsumers === 0) {
        stopPolling(entry)
      }
    }
  }, [active, entry])
  return {
    snapshot,
    attach: (terminal) => {
      const current = entryRef.current
      // A terminal mounted later shows what already streamed, then follows along.
      terminal.write(current.buffer)
      current.terminals.add(terminal)
      return () => current.terminals.delete(terminal)
    }
  }
}
