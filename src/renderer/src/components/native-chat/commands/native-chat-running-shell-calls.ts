import {
  isToolCallBlock,
  isToolResultBlock,
  type NativeChatBlock,
  type NativeChatToolCallBlock
} from '../../../../../shared/native-chat/native-chat-types'

/** A shell call still running: its lifecycle says so and no result answers it (a restored, abandoned call has neither). */
export function isRunningShellCall(
  block: NativeChatBlock,
  answered: boolean
): block is NativeChatToolCallBlock & { callId: string } {
  return (
    isToolCallBlock(block) &&
    block.name === 'Bash' &&
    block.callId !== undefined &&
    block.state === 'running' &&
    !answered
  )
}

/** A run's running shell calls, for the tails a collapsed run still shows. */
export function runningShellCalls(
  blocks: readonly NativeChatBlock[]
): (NativeChatToolCallBlock & { callId: string })[] {
  const answered = new Set(
    blocks.flatMap((block) => (isToolResultBlock(block) && block.callId ? [block.callId] : []))
  )
  return blocks.filter(
    (block): block is NativeChatToolCallBlock & { callId: string } =>
      isToolCallBlock(block) && isRunningShellCall(block, answered.has(block.callId ?? ''))
  )
}

/** The words a tail is named by: the command itself, else the tool's name. */
export function nativeChatShellCommandLabel(call: NativeChatToolCallBlock): string {
  const input = call.input
  const command =
    typeof input === 'object' && input !== null && 'command' in input ? input.command : undefined
  return typeof command === 'string' && command.trim() ? command.trim() : call.name
}
