import { useRef } from 'react'
import { SquareTerminal } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import { useNativeChatCommandTerminal } from './use-native-chat-command-terminal'
import {
  useNativeChatCommandOutputStream,
  type NativeChatCommandOutputStatus,
  type NativeChatCommandOutputSubject
} from './use-native-chat-command-output-stream'
import { useNativeChatOnScreen } from './use-native-chat-on-screen'
import { NATIVE_CHAT_COMMAND_ANNOUNCE_TIMEOUT_MS } from './native-chat-command-output-poll'

// The view holds a long-running command's recent history; the file on disk keeps all of it.
const VIEW_SCROLLBACK_ROWS = 5000

function useNotice(
  status: NativeChatCommandOutputStatus,
  shownAny: boolean,
  foreground: boolean
): string | null {
  const t = useTranslate()
  if (status === 'unavailable') {
    return t(
      'components.native-chat.commandOutput.unavailable',
      'Live output isn’t available for this command.'
    )
  }
  if (status === 'waiting') {
    return t('components.native-chat.commandOutput.waiting', 'Waiting for output…')
  }
  if (status === 'ended' && !shownAny) {
    // A foreground command's file is gone once it ends; what it printed is in its result.
    return foreground
      ? t(
          'components.native-chat.commandOutput.endedForeground',
          'The command finished; its output is in the conversation.'
        )
      : t('components.native-chat.commandOutput.empty', 'The command printed nothing.')
  }
  return null
}

/** A command's output, read-only, in place of the conversation. */
export function NativeChatCommandView({
  target,
  sessionId,
  subject,
  label,
  isVisible,
  onEscape
}: {
  target: RuntimeClientTarget
  sessionId: string
  /** A background task, or the call running a foreground command. */
  subject: NativeChatCommandOutputSubject
  label: string
  isVisible: boolean
  /** Leaves the view; xterm cancels the Esc it sees, so the pane's own handler never would. */
  onEscape?: () => void
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const onScreen = useNativeChatOnScreen(frameRef)
  const sink = useNativeChatCommandTerminal(terminalRef, {
    scrollback: VIEW_SCROLLBACK_ROWS,
    ...(onEscape ? { onEscape } : {})
  })
  const { status, skippedBytes, hasOutput } = useNativeChatCommandOutputStream({
    target,
    sessionId,
    subject,
    active: isVisible && onScreen,
    sink,
    // Opened by a call that may never run a task: give up as the inline tail does.
    ...('toolUseId' in subject ? { pendingTimeoutMs: NATIVE_CHAT_COMMAND_ANNOUNCE_TIMEOUT_MS } : {})
  })
  return (
    <NativeChatCommandOutputFrame
      label={label}
      status={status}
      skippedBytes={skippedBytes}
      hasOutput={hasOutput}
      foreground={'toolUseId' in subject}
      frameRef={frameRef}
      terminalRef={terminalRef}
    />
  )
}

/** The view's layout around a terminal the caller fills; fixtures fill it without a host. */
export function NativeChatCommandOutputFrame({
  label,
  status,
  skippedBytes,
  hasOutput,
  foreground = false,
  frameRef,
  terminalRef
}: {
  label: string
  status: NativeChatCommandOutputStatus
  skippedBytes: number
  /** Some output reached the terminal, so an ended command does not claim it printed nothing. */
  hasOutput: boolean
  /** Opened by the call running a foreground command, whose file goes away when it ends. */
  foreground?: boolean
  frameRef?: React.RefObject<HTMLDivElement | null>
  terminalRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const t = useTranslate()
  const notice = useNotice(status, hasOutput || skippedBytes > 0, foreground)
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-chat-pane">
      <div className="shrink-0 border-b border-border/60 px-3 sm:px-4">
        <div className="mx-auto flex h-10 w-full max-w-(--chat-content-max-width) min-w-0 items-center gap-2 px-[5px]">
          <SquareTerminal aria-hidden className="size-3.5 shrink-0 text-chat-foreground-faint" />
          <h2
            className="min-w-0 truncate text-sm font-medium text-chat-foreground-strong"
            title={label}
          >
            {label}
          </h2>
          <span className="shrink-0 rounded-full border border-border px-1.5 text-3xs text-chat-foreground-faint">
            {t('components.native-chat.commandOutput.readOnly', 'Read-only')}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4">
        <div
          ref={frameRef}
          className="relative mx-auto flex min-h-0 w-full max-w-(--chat-content-max-width) flex-1 flex-col overflow-hidden rounded-lg border border-chat-code-border bg-chat-code-surface"
        >
          {skippedBytes > 0 ? (
            <p className="shrink-0 border-b border-chat-code-border px-2 py-1 text-xs text-chat-foreground-faint">
              {t(
                'components.native-chat.commandOutput.skipped',
                'Showing the latest output; earlier lines are not shown.'
              )}
            </p>
          ) : null}
          <div
            ref={terminalRef}
            role="log"
            aria-label={t('components.native-chat.commandOutput.label', 'Output of {{value0}}', {
              value0: label
            })}
            className="min-h-0 flex-1 p-2"
          />
          {notice ? (
            <p
              role="status"
              className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center text-sm text-chat-foreground-faint"
            >
              {notice}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
