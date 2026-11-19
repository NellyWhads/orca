// Polls a command's live output from its host while a view of it is on screen, and hands each chunk straight to
// the caller's terminal: output never enters React state or a store, so it cannot re-render the conversation.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { AgentSessionReadCommandOutputResult } from '../../../../../shared/rpc-contract/native-chat/agent-session-command-output-params'

export type NativeChatCommandOutputSubject = { taskId: string } | { toolUseId: string }

/** `waiting`: nothing to show yet. `live`: output is arriving. `ended`: all of it is shown. */
export type NativeChatCommandOutputStatus = 'waiting' | 'live' | 'ended' | 'unavailable'

export type NativeChatCommandOutputSink = {
  write: (text: string) => void
  /** The file restarted (or a first read skipped older output): drop what is shown. */
  reset: () => void
}

const FAST_MS = 250
const START_MS = 500
const IDLE_MAX_MS = 2000
const READ_TIMEOUT_MS = 5000
const MAX_FAILURES = 3

async function readChunk(
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
type PollProgress = {
  key: string
  sink: NativeChatCommandOutputSink | null
  offset: number
  settled: boolean
}

type PollReport = { status?: NativeChatCommandOutputStatus; skippedBytes?: number }

/** The polling loop, outside React: returns its stop. Fast while output grows, backing off to 2 s while not. */
function startCommandOutputPoll(input: {
  read: (offset: number) => Promise<AgentSessionReadCommandOutputResult | null>
  progress: PollProgress
  sink: NativeChatCommandOutputSink
  report: (report: PollReport) => void
  /** Give up when nothing has announced the command for this long (a call that never ran a task). */
  pendingTimeoutMs?: number
}): () => void {
  const { read, progress, sink, report, pendingTimeoutMs } = input
  const startedAt = Date.now()
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
    if (result.reset || (result.skippedBytes && progress.offset === 0)) {
      sink.reset()
    } else if (result.skippedBytes) {
      // The writer outran the reader: say where output was left out rather than run behind it.
      sink.write(`\r\n\x1b[2m… ${formatSkipped(result.skippedBytes)} skipped …\x1b[0m\r\n`)
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
  void tick()
  return () => {
    loop.cancelled = true
    if (loop.timer) {
      clearTimeout(loop.timer)
    }
  }
}

/**
 * Streams while `active` (mounted, on screen, window visible); stops for good once the command ended and was
 * drained, or the host cannot read it.
 */
export function useNativeChatCommandOutputStream(input: {
  target: RuntimeClientTarget
  sessionId: string
  subject: NativeChatCommandOutputSubject
  active: boolean
  sink: NativeChatCommandOutputSink | null
  pendingTimeoutMs?: number
}): { status: NativeChatCommandOutputStatus; skippedBytes: number; hasOutput: boolean } {
  const { target, sessionId, active, sink, pendingTimeoutMs } = input
  const subjectKey =
    'taskId' in input.subject ? `t:${input.subject.taskId}` : `u:${input.subject.toolUseId}`
  // Callers rebuild these objects each render; the loop reads the latest without restarting.
  const latest = useRef({ subject: input.subject, target })
  useLayoutEffect(() => {
    latest.current = { subject: input.subject, target }
  })
  const targetKey = target.kind === 'local' ? 'local' : `env:${target.environmentId}`
  const [shown, setShown] = useState<{
    key: string
    status: NativeChatCommandOutputStatus
    skippedBytes: number
    /** Some output reached the terminal; stays true once the command ends. */
    hasOutput: boolean
  }>({ key: subjectKey, status: 'waiting', skippedBytes: 0, hasOutput: false })
  // Survives pauses (scrolled away, pane hidden) so a resumed view continues where it stopped.
  const progress = useRef<PollProgress>({ key: subjectKey, sink: null, offset: 0, settled: false })

  useEffect(() => {
    // A new subject, or a new terminal that shows nothing yet, reads from the top.
    if (progress.current.key !== subjectKey || (sink && progress.current.sink !== sink)) {
      progress.current = { key: subjectKey, sink, offset: 0, settled: false }
    }
    const current = progress.current
    if (!active || !sink || current.settled) {
      return
    }
    return startCommandOutputPoll({
      read: (offset) => {
        const { subject, target: host } = latest.current
        return readChunk(host, sessionId, subject, offset)
      },
      progress: current,
      sink,
      ...(pendingTimeoutMs !== undefined ? { pendingTimeoutMs } : {}),
      report: (report) =>
        setShown((prior) => {
          const same = prior.key === subjectKey
          return {
            key: subjectKey,
            status: report.status ?? (same ? prior.status : 'waiting'),
            skippedBytes: report.skippedBytes ?? (same ? prior.skippedBytes : 0),
            hasOutput: report.status === 'live' || (same && prior.hasOutput)
          }
        })
    })
  }, [active, pendingTimeoutMs, sessionId, sink, subjectKey, targetKey])

  return shown.key === subjectKey
    ? { status: shown.status, skippedBytes: shown.skippedBytes, hasOutput: shown.hasOutput }
    : { status: 'waiting', skippedBytes: 0, hasOutput: false }
}
