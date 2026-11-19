import { useMemo } from 'react'
import type {
  AgentSessionBackgroundTask,
  AgentSessionBackgroundTaskRunState
} from '../../../../../shared/agent-session/background-tasks/agent-session-background-task-wire'
import type {
  NativeChatSubagentEntry,
  NativeChatSubagentState
} from '../../../../../shared/native-chat/native-chat-types'
import type { StructuredSessionTaskStop } from '../tools/tasks/use-structured-session-task-stop'
import { NativeChatSubagentStatusBar } from '../subagents/NativeChatSubagentStatusBar'

/** Roster vocabulary to the subagent bar's: one bar shape for every view that replaces the composer. */
const BAR_STATE: Record<AgentSessionBackgroundTaskRunState, NativeChatSubagentState> = {
  working: 'working',
  monitoring: 'working',
  waiting: 'working',
  blocked: 'failed',
  done: 'completed',
  idle: 'stopped',
  unverifiable: 'unverifiable'
}

/** The open command's state, elapsed time, Stop while it runs, and the way back. */
export function NativeChatCommandStatusBar({
  task,
  live,
  supportsStop,
  stop,
  backTo,
  onBack
}: {
  /** The roster's entry for the command; absent once the roster no longer lists it. */
  task: AgentSessionBackgroundTask | undefined
  /** The roster lists it among running work. */
  live: boolean
  supportsStop: boolean
  stop: StructuredSessionTaskStop
  /** The subagent whose view opened the command; absent for the main conversation. */
  backTo?: string
  onBack: () => void
}): React.JSX.Element {
  const entry = useMemo<NativeChatSubagentEntry | undefined>(
    () =>
      task
        ? {
            id: task.id,
            label: task.description ?? task.name ?? task.id,
            state: BAR_STATE[task.state ?? 'working'] ?? 'unverifiable',
            ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {})
          }
        : undefined,
    [task]
  )
  const canStop = task !== undefined && live && supportsStop && task.stoppable !== false
  return (
    <NativeChatSubagentStatusBar
      entry={entry}
      stop={
        canStop
          ? {
              stopping: stop.stoppingTaskIds.has(task.id),
              onStop: () => stop.onStop(task.id)
            }
          : undefined
      }
      backTo={backTo}
      onBack={onBack}
    />
  )
}
