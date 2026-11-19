import type { StructuredAgentSessionCommandOutputs } from '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter-stop'
import type { ClaudeSession } from './claude-structured-session-state'

/** A live child's shell output, read through the locator that watches its frames. */
export function claudeCommandOutputs(
  sessions: ReadonlyMap<string, ClaudeSession>
): StructuredAgentSessionCommandOutputs {
  return {
    readable: (sessionId) => sessions.get(sessionId)?.commandOutput.readableTaskIds(),
    read: async ({ sessionId, target, offset }) =>
      (await sessions.get(sessionId)?.commandOutput.read(target, offset)) ?? {
        status: 'unavailable'
      }
  }
}
