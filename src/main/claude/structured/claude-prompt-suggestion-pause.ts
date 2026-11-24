import type { ClaudeControlSurface } from '../sdk-transport/claude-agent-sdk-control-requests'

/** Present only when the launch enabled suggestions; `paused` is what this process was last told. */
export type ClaudePromptSuggestionPause = { ready: boolean; paused: boolean }

/** A new process generates until told otherwise. */
export function claudePromptSuggestionPause(): ClaudePromptSuggestionPause {
  return { ready: false, paused: false }
}

type ClaudePausableSession = {
  connection: Pick<ClaudeControlSurface, 'setPromptSuggestionsPaused'>
  promptSuggestionPause?: ClaudePromptSuggestionPause
}

/** Generate only while a reader shows suggestions; a refused or lost request leaves it as it was. */
export function syncClaudePromptSuggestionPause(
  session: ClaudePausableSession,
  wanted: boolean
): void {
  const state = session.promptSuggestionPause
  if (!state?.ready || state.paused === !wanted) {
    return
  }
  state.paused = !wanted
  void session.connection.setPromptSuggestionsPaused?.(!wanted).catch(() => {})
}

/** Record whether a reader shows this session's suggestions, and pause or resume its live process to match. */
export function noteClaudePromptSuggestionInterest(
  readers: Set<string>,
  sessions: ReadonlyMap<string, ClaudePausableSession>,
  sessionId: string,
  wanted: boolean
): void {
  if (wanted) {
    readers.add(sessionId)
  } else {
    readers.delete(sessionId)
  }
  const session = sessions.get(sessionId)
  if (session) {
    syncClaudePromptSuggestionPause(session, wanted)
  }
}

/** Once initialize has answered, so the CLI already runs with suggestions on. */
export function readyClaudePromptSuggestionPause(
  session: ClaudePausableSession,
  wanted: boolean
): void {
  if (session.promptSuggestionPause) {
    session.promptSuggestionPause.ready = true
    syncClaudePromptSuggestionPause(session, wanted)
  }
}
