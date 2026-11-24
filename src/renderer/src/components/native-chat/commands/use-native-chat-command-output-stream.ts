// The command view's stream: polls while the view is on screen and writes straight into its terminal.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import {
  nativeChatCommandSubjectKey,
  readNativeChatCommandOutputChunk,
  startCommandOutputPoll,
  type NativeChatCommandOutputSink,
  type NativeChatCommandOutputStatus,
  type NativeChatCommandOutputSubject,
  type PollProgress
} from './native-chat-command-output-poll'

export type {
  NativeChatCommandOutputSink,
  NativeChatCommandOutputStatus,
  NativeChatCommandOutputSubject
} from './native-chat-command-output-poll'

/** Streams while `active` (mounted, on screen, window visible) until drained after its end, or unreadable. */
export function useNativeChatCommandOutputStream(input: {
  target: RuntimeClientTarget
  sessionId: string
  subject: NativeChatCommandOutputSubject
  active: boolean
  sink: NativeChatCommandOutputSink | null
  pendingTimeoutMs?: number
}): { status: NativeChatCommandOutputStatus; skippedBytes: number; hasOutput: boolean } {
  const { target, sessionId, active, sink, pendingTimeoutMs } = input
  const subjectKey = nativeChatCommandSubjectKey(input.subject)
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
        return readNativeChatCommandOutputChunk(host, sessionId, subject, offset)
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
