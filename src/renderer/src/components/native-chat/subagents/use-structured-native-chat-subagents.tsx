import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { AgentSessionCancelResult } from '../../../../../shared/agent-session/agent-session-wire'
import type { StructuredAgentSubagentRoster } from '../../../../../shared/agent-session/view/structured-agent-session-subagent-roster'
import type { StructuredSessionBackgroundTasksView } from '../../../../../shared/agent-session/view/structured-session-background-tasks-view'
import { NativeChatStructuredSessionStatus } from '../tools/tasks/NativeChatStructuredSessionStatus'
import { useStructuredSessionTaskStop } from '../tools/tasks/use-structured-session-task-stop'
import { useTranslate } from '@/i18n/use-translate'
import { useWorkerDockColdSeed } from '../tools/tasks/dock/worker-dock-feed'
import { NativeChatStructuredDock } from './NativeChatStructuredDock'
import {
  backFromNativeChatSubagent,
  closeNativeChatSubagentOnEscape,
  useNativeChatOpenSubagent
} from './native-chat-open-subagent'
import { NativeChatStructuredSubagentStatusBar } from './NativeChatSubagentStatusBar'
import { nativeChatWorkerApprovalParty } from '../worker-approvals/NativeChatWorkerApprovals'
import { NativeChatPairedServerAskStack } from '../paired-server-asks/NativeChatPairedServerAskStack'
import {
  closeNativeChatCommand,
  useNativeChatOpenCommand
} from '../commands/native-chat-open-command'
import { closeNativeChatCommandOnEscape } from '../commands/native-chat-command-escape'
import { NativeChatCommandStatusBar } from '../commands/NativeChatCommandStatusBar'
import { journaledCommandTask } from '../commands/native-chat-command-journal-task'
import type { AgentJournalRenderItem } from '../../../../../shared/agent-session/journal/agent-session-journal-types'
import { NativeChatCommandOutputProvider } from '../commands/native-chat-command-output-context'

/** A structured chat's agents strip and open subagent's bar, which share the strip's one Stop. */
export function useStructuredNativeChatSubagents({
  sessionId,
  target,
  paneKey,
  isVisible,
  controller
}: {
  sessionId: string
  target: RuntimeClientTarget
  paneKey: string
  isVisible: boolean
  controller: {
    subagentRoster?: StructuredAgentSubagentRoster
    backgroundTasks: StructuredSessionBackgroundTasksView
    stopBackgroundTask: (taskId?: string) => Promise<AgentSessionCancelResult | null>
    journalItems?: readonly AgentJournalRenderItem[]
  }
}) {
  const t = useTranslate()
  const open = useNativeChatOpenSubagent(paneKey)
  const openId = open?.agentId ?? null
  const parentId = open?.parentId ?? null
  const stop = useStructuredSessionTaskStop(sessionId, controller)
  const background = controller.backgroundTasks
  useWorkerDockColdSeed(target, sessionId, isVisible, background.workerDock)
  const hasWork = Boolean(
    background.workerDock?.open ||
    background.tasks.length ||
    background.children?.length ||
    background.incomplete
  )
  const strip = (
    <NativeChatStructuredSessionStatus
      sessionId={sessionId}
      target={target}
      paneKey={paneKey}
      isVisible={isVisible}
      backgroundTasks={controller.backgroundTasks}
      stop={stop}
      currentAgentId={openId}
    />
  )
  const party = nativeChatWorkerApprovalParty({ sessionId })
  const command = useNativeChatOpenCommand(paneKey)
  const { tasks, settledTasks } = background
  const commandTaskId = command && 'taskId' in command.subject ? command.subject.taskId : null
  // A foreground command opened by its call has no roster entry; its bar offers only Back.
  const commandTask =
    commandTaskId === null
      ? undefined
      : (tasks.find((task) => task.id === commandTaskId) ??
        settledTasks.find((task) => task.id === commandTaskId) ??
        // The roster drops a finished task; its transcript row still says how it ended.
        journaledCommandTask(controller.journalItems, commandTaskId))
  const subagentLabel = (agentId: string) =>
    controller.subagentRoster?.get(agentId)?.entry.label ??
    t('components.native-chat.subagents.unnamed', 'Subagent')
  return {
    /** The subagent whose view replaces the conversation and the composer; null for none. */
    openId,
    /** A subagent's or a command's view replaces the conversation and the composer. */
    viewOpen: openId !== null || command !== null,
    /** Rows, the agents strip and the command view read this session's command output through it. */
    provideCommandOutput: (pane: React.ReactNode) => (
      <NativeChatCommandOutputProvider
        target={target}
        sessionId={sessionId}
        paneKey={paneKey}
        tasks={tasks}
        settledTasks={settledTasks}
      >
        {pane}
      </NativeChatCommandOutputProvider>
    ),
    onKeyDown: (event: React.KeyboardEvent) => {
      // A command view sits above any subagent view: Esc leaves it first.
      closeNativeChatCommandOnEscape(event, paneKey)
      closeNativeChatSubagentOnEscape(event, paneKey)
    },
    dock: isVisible ? (
      <NativeChatStructuredDock
        hasWork={hasWork}
        strip={strip}
        target={target}
        party={party}
        isVisible={isVisible}
      />
    ) : null,
    /** Agents in this paired server's chat asking agents on this computer: answered here. */
    pairedAsks: <NativeChatPairedServerAskStack target={target} party={party} />,
    statusBar: command ? (
      <NativeChatCommandStatusBar
        task={commandTask}
        live={tasks.some((task) => task.id === commandTaskId)}
        supportsStop={background.supportsStop}
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
