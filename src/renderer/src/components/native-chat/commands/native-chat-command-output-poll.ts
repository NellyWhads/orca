// Polls a command's output from its host and hands each chunk to a sink, never to React state.

import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { AgentSessionReadCommandOutputResult } from '../../../../../shared/rpc-contract/native-chat/agent-session-command-output-params'

export type NativeChatCommandOutputSubject = { taskId: string } | { toolUseId: string }

export function nativeChatCommandSubjectKey(subject: NativeChatCommandOutputSubject): string {
  return 'taskId' in subject ? `t:${subject.taskId}` : `u:${subject.toolUseId}`
}

/** `waiting`: nothing to show yet. `live`: output is arriving. `ended`: all of it is shown. */
export type NativeChatCommandOutputStatus = 'waiting' | 'live' | 'ended' | 'unavailable'

export type NativeChatCommandOutputSink = {
  write: (text: string) => void
  /** The file restarted, or a read skipped output: drop what is shown and any terminal modes it set. */
  reset: () => void
}

const FAST_MS = 250
const START_MS = 500
const IDLE_MAX_MS = 2000
const READ_TIMEOUT_MS = 5000
const MAX_FAILURES = 3
/** Claude Code announces a foreground command about 5 s in; a call silent this long never ran a task. */
export const NATIVE_CHAT_COMMAND_ANNOUNCE_TIMEOUT_MS = 30_000

export async function readNativeChatCommandOutputChunk(
  target: RuntimeClientTarget,
  sessionId: string,
  subject: NativeChatCommandOutputSubject,
  offset: number
): Promise<AgentSessionReadCommandOutputResult | null> {
  try {
    return await callRuntimeRpc<AgentSessionReadCommandOutputResult>(
      target,
      'agentSession.readCommandOutput',
      { sessionId, ...subject, offset },
      { timeoutMs: READ_TIMEOUT_MS, suppressFeatureInteraction: true }
    )
  } catch {
    return null
  }
}

function formatSkipped(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Where a subject's stream stands; a different terminal (sink) starts it over, since it shows nothing yet. */
export type PollProgress = {
  key: string
  sink: NativeChatCommandOutputSink | null
  offset: number
  settled: boolean
}

export type PollReport = { status?: NativeChatCommandOutputStatus; skippedBytes?: number }

/** The polling loop, outside React: returns its stop. Fast while output grows, backing off to 2 s while not. */
export function startCommandOutputPoll(input: {
  read: (offset: number) => Promise<AgentSessionReadCommandOutputResult | null>
  progress: PollProgress
  sink: NativeChatCommandOutputSink
  report: (report: PollReport) => void
  /** Give up when nothing has announced the command for this long (a call that never ran a task). */
  pendingTimeoutMs?: number
  /** When the wait for an announcement began; a resumed poll keeps the original clock. */
  pendingSince?: number
  /** Before the first read: most commands finish before a task is announced, and never need one. */
  initialDelayMs?: number
}): () => void {
  const { read, progress, sink, report, pendingTimeoutMs } = input
  const startedAt = input.pendingSince ?? Date.now()
  const loop: {
    cancelled: boolean
    timer: ReturnType<typeof setTimeout> | null
    idleDelay: number
    failures: number
    reportedLive: boolean
    reportedSkipped: number
  } = {
    cancelled: false,
    timer: null,
    idleDelay: START_MS,
    failures: 0,
    // Report a change of state once, never per chunk: a chunk must not re-render the view.
    reportedLive: false,
    reportedSkipped: 0
  }
  const schedule = (delay: number) => {
    if (!loop.cancelled) {
      loop.timer = setTimeout(() => void tick(), delay)
    }
  }
  const settle = (status: NativeChatCommandOutputStatus) => {
    progress.settled = true
    report({ status })
  }
  const tick = async () => {
    const result = await read(progress.offset)
    if (loop.cancelled) {
      return
    }
    if (result === null) {
      // A dropped call is retried; a host that keeps failing has no live output for us.
      loop.failures += 1
      if (loop.failures >= MAX_FAILURES) {
        settle('unavailable')
      } else {
        schedule(IDLE_MAX_MS)
      }
      return
    }
    loop.failures = 0
    if (result.status === 'unavailable') {
      settle('unavailable')
      return
    }
    if (result.status === 'pending') {
      if (pendingTimeoutMs !== undefined && Date.now() - startedAt > pendingTimeoutMs) {
        settle('unavailable')
        return
      }
      loop.idleDelay = Math.min(loop.idleDelay * 2, IDLE_MAX_MS)
      schedule(loop.idleDelay)
      return
    }
    if (result.reset || result.skippedBytes) {
      // A skip can cut through an escape sequence or leave a mode it set on: start from a clean terminal.
      sink.reset()
    }
    if (result.skippedBytes && progress.offset > 0) {
      // The writer outran the reader: say where output was left out rather than run behind it.
      sink.write(`\x1b[2m… ${formatSkipped(result.skippedBytes)} skipped …\x1b[0m\r\n`)
    }
    const grew = result.text.length > 0
    if (grew) {
      sink.write(result.text)
    }
    const newlyLive = grew && !loop.reportedLive
    const newlySkipped =
      Boolean(result.skippedBytes) && result.skippedBytes !== loop.reportedSkipped
    if (newlyLive || newlySkipped) {
      loop.reportedLive ||= newlyLive
      loop.reportedSkipped = result.skippedBytes ?? loop.reportedSkipped
      report({
        ...(newlyLive ? { status: 'live' as const } : {}),
        ...(newlySkipped ? { skippedBytes: result.skippedBytes } : {})
      })
    }
    progress.offset = result.offset
    if (result.ended && !result.more) {
      settle('ended')
      return
    }
    loop.idleDelay = grew ? START_MS : Math.min(loop.idleDelay * 2, IDLE_MAX_MS)
    schedule(result.more ? FAST_MS : loop.idleDelay)
  }
  if (input.initialDelayMs) {
    schedule(input.initialDelayMs)
  } else {
    void tick()
  }
  return () => {
    loop.cancelled = true
    if (loop.timer) {
      clearTimeout(loop.timer)
    }
  }
}
