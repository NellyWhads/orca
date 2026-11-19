// Stream a shell command's live output from the host that runs it; clients name the task, never a path.
// Older hosts lack the method; clients treat any refusal as "no live output".

import { assertBotGroupSessionAccess } from '../../../../../bots/bot-group-session-access'
import {
  ReadCommandOutputParams,
  type AgentSessionReadCommandOutputResult
} from '../../../../../../shared/rpc-contract/native-chat/agent-session-command-output-params'
import { defineMethod } from '../../../core'
import { requireInstalledStructuredHost } from '../creation/structured-agent-session-gate'

export const STRUCTURED_AGENT_SESSION_COMMAND_OUTPUT_METHODS = [
  defineMethod({
    name: 'agentSession.readCommandOutput',
    permission: 'workspace',
    params: ReadCommandOutputParams,
    handler: async (params, ctx): Promise<AgentSessionReadCommandOutputResult> => {
      assertBotGroupSessionAccess(ctx.runtime, params.sessionId, ctx.caller, true)
      const host = await requireInstalledStructuredHost(ctx)
      const target = params.taskId
        ? { taskId: params.taskId }
        : params.toolUseId
          ? { toolUseId: params.toolUseId }
          : null
      if (!target || !host.deps.adapter.commandOutputs) {
        return { status: 'unavailable' }
      }
      try {
        return await host.deps.adapter.commandOutputs.read({
          sessionId: params.sessionId,
          target,
          offset: params.offset
        })
      } catch {
        // The file layout is Claude Code's; any surprise reads as no live output.
        return { status: 'unavailable' }
      }
    }
  })
]
