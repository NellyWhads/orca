import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionCommandOutputs } from './structured-agent-session-adapter-stop'

/** Only a live child knows where its output goes; other providers and released sessions have none. */
export function routedCommandOutputs(
  liveOwner: (sessionId: string) => StructuredAgentSessionAdapter | null
): StructuredAgentSessionCommandOutputs {
  return {
    readable: (sessionId) => liveOwner(sessionId)?.commandOutputs?.readable(sessionId),
    read: (input) =>
      liveOwner(input.sessionId)?.commandOutputs?.read(input) ??
      Promise.resolve({ status: 'unavailable' })
  }
}
