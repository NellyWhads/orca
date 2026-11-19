import type { AgentSessionCancelResult } from '../../../../../shared/agent-session/agent-session-wire'
import type { StructuredAgentSubagentRoster } from '../../../../../shared/agent-session/view/structured-agent-session-subagent-roster'
import type { StructuredSessionBackgroundTasksView } from '../../../../../shared/agent-session/view/structured-session-background-tasks-view'
import { NativeChatStructuredSessionStatus } from '../tools/tasks/NativeChatStructuredSessionStatus'
import { useStructuredSessionTaskStop } from '../tools/tasks/use-structured-session-task-stop'
import { useTranslate } from '@/i18n/use-translate'
import {
  backFromNativeChatSubagent,
  closeNativeChatSubagentOnEscape,
  useNativeChatOpenSubagent
} from './native-chat-open-subagent'
import { NativeChatStructuredSubagentStatusBar } from './NativeChatSubagentStatusBar'
import {
  closeNativeChatCommand,
  useNativeChatOpenCommand
} from '../commands/native-chat-open-command'
import { closeNativeChatCommandOnEscape } from '../commands/native-chat-command-escape'
import { NativeChatCommandStatusBar } from '../commands/NativeChatCommandStatusBar'

/** A structured chat's agents strip and open subagent's bar, which share the strip's one Stop. */
export function useStructuredNativeChatSubagents({
  sessionId,
  paneKey,
  isVisible,
  controller
}: {
  sessionId: string
  paneKey: string
  isVisible: boolean
  controller: {
    subagentRoster?: StructuredAgentSubagentRoster
    backgroundTasks: StructuredSessionBackgroundTasksView
    stopBackgroundTask: (taskId?: string) => Promise<AgentSessionCancelResult | null>
  }
}) {
  const t = useTranslate()
  const open = useNativeChatOpenSubagent(paneKey)
  const openId = open?.agentId ?? null
  const parentId = open?.parentId ?? null
  const stop = useStructuredSessionTaskStop(sessionId, controller)
  const command = useNativeChatOpenCommand(paneKey)
  const { tasks, settledTasks } = controller.backgroundTasks
  const commandTaskId = command && 'taskId' in command.subject ? command.subject.taskId : null
  // A foreground command opened by its call has no roster entry; its bar offers only Back.
  const commandTask =
    commandTaskId === null
      ? undefined
      : (tasks.find((task) => task.id === commandTaskId) ??
        settledTasks.find((task) => task.id === commandTaskId))
  const subagentLabel = (agentId: string) =>
    controller.subagentRoster?.get(agentId)?.entry.label ??
    t('components.native-chat.subagents.unnamed', 'Subagent')
  return {
    /** The subagent whose view replaces the conversation and the composer; null for none. */
    openId,
    /** A subagent's or a command's view replaces the conversation and the composer. */
    viewOpen: openId !== null || command !== null,
    onKeyDown: (event: React.KeyboardEvent) => {
      // A command view sits above any subagent view: Esc leaves it first.
      closeNativeChatCommandOnEscape(event, paneKey)
      closeNativeChatSubagentOnEscape(event, paneKey)
    },
    strip: (
      <NativeChatStructuredSessionStatus
        sessionId={sessionId}
        paneKey={paneKey}
        isVisible={isVisible}
        backgroundTasks={controller.backgroundTasks}
        stop={stop}
        currentAgentId={openId}
      />
    ),
    statusBar: command ? (
      <NativeChatCommandStatusBar
        task={commandTask}
        live={tasks.some((task) => task.id === commandTaskId)}
        supportsStop={controller.backgroundTasks.supportsStop}
        stop={stop}
        backTo={command.returnTo === null ? undefined : subagentLabel(command.returnTo)}
        onBack={() => closeNativeChatCommand(paneKey)}
      />
    ) : openId === null ? null : (
      <NativeChatStructuredSubagentStatusBar
        agentId={openId}
        entry={controller.subagentRoster?.get(openId)?.entry}
        paneKey={paneKey}
        backgroundTasks={controller.backgroundTasks}
        stop={stop}
        backTo={parentId === null ? undefined : subagentLabel(parentId)}
        onBack={() => backFromNativeChatSubagent(paneKey)}
      />
    )
  }
}
