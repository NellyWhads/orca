// Gives transcript rows, the agents strip and the command view the session whose command output they read.

import { createContext, use, useMemo } from 'react'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { AgentSessionBackgroundTask } from '../../../../../shared/agent-session/background-tasks/agent-session-background-task-wire'
import { currentNativeChatSubagent } from '../subagents/native-chat-open-subagent'
import { openNativeChatCommand } from './native-chat-open-command'

export type NativeChatCommandOutputScope = {
  target: RuntimeClientTarget
  sessionId: string
  paneKey: string
  /** Commands whose host can stream their output, by task id. */
  readable: ReadonlyMap<string, AgentSessionBackgroundTask>
  /** Open a readable command's output in place of the conversation, titled with its row's words. */
  open: (taskId: string, label: string) => void
}

const NativeChatCommandOutputContext = createContext<NativeChatCommandOutputScope | null>(null)

const NO_READABLE: ReadonlyMap<string, AgentSessionBackgroundTask> = new Map()

function readableCommands(
  tasks: readonly AgentSessionBackgroundTask[],
  settledTasks: readonly AgentSessionBackgroundTask[]
): ReadonlyMap<string, AgentSessionBackgroundTask> {
  let readable: Map<string, AgentSessionBackgroundTask> | null = null
  for (const task of [...settledTasks, ...tasks]) {
    if (task.kind === 'command' && task.outputReadable) {
      readable ??= new Map()
      readable.set(task.id, task)
    }
  }
  return readable ?? NO_READABLE
}

export function NativeChatCommandOutputProvider({
  target,
  sessionId,
  paneKey,
  tasks,
  settledTasks,
  children
}: {
  target: RuntimeClientTarget
  sessionId: string
  paneKey: string
  tasks: readonly AgentSessionBackgroundTask[]
  settledTasks: readonly AgentSessionBackgroundTask[]
  children: React.ReactNode
}): React.JSX.Element {
  const readable = useMemo(() => readableCommands(tasks, settledTasks), [tasks, settledTasks])
  const scope = useMemo<NativeChatCommandOutputScope>(
    () => ({
      target,
      sessionId,
      paneKey,
      readable,
      open: (taskId, label) =>
        openNativeChatCommand(paneKey, {
          taskId,
          label,
          returnTo: currentNativeChatSubagent(paneKey)
        })
    }),
    [paneKey, readable, sessionId, target]
  )
  return <NativeChatCommandOutputContext value={scope}>{children}</NativeChatCommandOutputContext>
}

/** Null outside a structured chat that can read command output. */
export function useNativeChatCommandOutputScope(): NativeChatCommandOutputScope | null {
  return use(NativeChatCommandOutputContext)
}
