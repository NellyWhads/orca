import { z } from 'zod'
import { SessionId } from '../structured-agent-session/structured-agent-session-identifiers'

// Clients name a task or call, never a path, so they cannot steer the host to read another file.

/** Provider task ids and tool-call ids are short opaque tokens; anything else is refused. */
const CommandOutputId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)

export const ReadCommandOutputParams = z
  .object({
    sessionId: SessionId,
    /** The background task's id, as the roster lists it. */
    taskId: CommandOutputId.optional(),
    /** Or the tool call that runs a foreground command; the host maps it to its task. */
    toolUseId: CommandOutputId.optional(),
    /** Bytes the client already holds; 0 for a first read. */
    offset: z.number().int().nonnegative()
  })
  .strict()
  .refine((params) => (params.taskId === undefined) !== (params.toolUseId === undefined), {
    message: 'Name exactly one of taskId or toolUseId'
  })

export type AgentSessionReadCommandOutputParams = z.infer<typeof ReadCommandOutputParams>

export type AgentSessionReadCommandOutputResult =
  /** This host cannot show it: another agent, an unknown layout, or a file Claude Code never wrote. */
  | { status: 'unavailable' }
  /** A known command whose output has not appeared yet; poll again. */
  | { status: 'pending' }
  | {
      status: 'output'
      text: string
      /** Where the next read starts. */
      offset: number
      /** The command finished; once `more` is false too, nothing further will arrive. */
      ended: boolean
      more: boolean
      /** Output left out: older history on a first read, or a backlog a fast writer built up. */
      skippedBytes?: number
      /** The file shrank or was replaced; the text starts it over. */
      reset?: true
    }
