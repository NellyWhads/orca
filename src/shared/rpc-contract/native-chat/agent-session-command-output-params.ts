import { z } from 'zod'
import { SessionId } from '../structured-agent-session/structured-agent-session-identifiers'

// Read a running shell command's output on its owning host. Clients name the task, never a path:
// the host resolves the file itself, so a client cannot steer it to read anything else.

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

/**
 * `unavailable`: this host cannot show the command's output (other agents, older or remote layouts, a file Claude
 * Code never wrote). `pending`: a known command whose output has not appeared yet; poll again.
 * `output`: bytes from `offset`, which is where the next read starts. `ended` says the command finished; once
 * `more` is false too, nothing further will arrive. `reset` means the file shrank and the text restarts it;
 * `skippedBytes` counts older output left out of a first read of a long file.
 */
export type AgentSessionReadCommandOutputResult =
  | { status: 'unavailable' }
  | { status: 'pending' }
  | {
      status: 'output'
      text: string
      offset: number
      ended: boolean
      more: boolean
      skippedBytes?: number
      reset?: true
    }
