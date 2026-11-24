import type { AgentSessionBackgroundTask } from '../../../../../shared/agent-session/background-tasks/agent-session-background-task-wire'
import type { AgentJournalRenderItem } from '../../../../../shared/agent-session/journal/agent-session-journal-types'
import { isBackgroundTaskBlock } from '../../../../../shared/native-chat/native-chat-types'

/** The transcript's durable row for a task, which keeps its outcome after the roster drops it. */
export function journaledCommandTask(
  items: readonly AgentJournalRenderItem[] | undefined,
  taskId: string
): AgentSessionBackgroundTask | undefined {
  for (let index = (items?.length ?? 0) - 1; index >= 0; index--) {
    const body = items![index].body
    const block =
      body.kind === 'message'
        ? body.blocks.find(
            (candidate) => isBackgroundTaskBlock(candidate) && candidate.taskId === taskId
          )
        : undefined
    if (block && isBackgroundTaskBlock(block)) {
      return {
        id: block.taskId,
        kind: block.kind,
        description: block.label,
        state: block.state,
        ...(block.startedAt !== undefined ? { startedAt: block.startedAt } : {})
      }
    }
  }
  return undefined
}
