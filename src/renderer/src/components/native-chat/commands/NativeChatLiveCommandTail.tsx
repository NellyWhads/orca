import { use, useEffect, useId, useRef, useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useNativeChatCommandOutputScope } from './native-chat-command-output-context'
import { useNativeChatLiveTailSlot } from './native-chat-live-tail-slots'
import { NativeChatLiveTailVisibleContext } from './native-chat-live-tail-visibility'
import { useNativeChatCommandOutputStream } from './use-native-chat-command-output-stream'
import { useNativeChatCommandTerminal } from './use-native-chat-command-terminal'
import { useNativeChatOnScreen } from './use-native-chat-on-screen'

// Fixed rows, so the row grows once when output first appears and never again while it streams.
const TAIL_ROWS = 8
const TAIL_SCROLLBACK_ROWS = 500
// Claude Code announces a foreground command about 5 s in; a call silent this long never ran a task.
const ANNOUNCE_TIMEOUT_MS = 30_000
// A command that ends sooner never earns a control, so short commands do not flash one.
const OVER_CAP_REVEAL_MS = 5_000

/** A running foreground command's output under its call row, until its result replaces it. */
export function NativeChatLiveCommandTail({
  toolUseId,
  label
}: {
  toolUseId: string
  label: string
}): React.JSX.Element | null {
  const scope = useNativeChatCommandOutputScope()
  const isVisible = use(NativeChatLiveTailVisibleContext)
  const claimKey = `${useId()}:${toolUseId}`
  const hasSlot = useNativeChatLiveTailSlot(claimKey)
  if (!scope) {
    return null
  }
  return hasSlot ? (
    <LiveTailTerminal toolUseId={toolUseId} label={label} isVisible={isVisible} />
  ) : (
    <OverCapButton onOpen={() => scope.openToolCall(toolUseId, label)} />
  )
}

function LiveTailTerminal({
  toolUseId,
  label,
  isVisible
}: {
  toolUseId: string
  label: string
  isVisible: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const scope = useNativeChatCommandOutputScope()
  const frameRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const onScreen = useNativeChatOnScreen(frameRef)
  const sink = useNativeChatCommandTerminal(terminalRef, {
    rows: TAIL_ROWS,
    scrollback: TAIL_SCROLLBACK_ROWS
  })
  const { status, hasOutput } = useNativeChatCommandOutputStream({
    target: scope?.target ?? { kind: 'local' },
    sessionId: scope?.sessionId ?? '',
    subject: { toolUseId },
    active: scope !== null && isVisible && onScreen,
    sink,
    pendingTimeoutMs: ANNOUNCE_TIMEOUT_MS
  })
  // Mounted from the start so it can stream; it takes space only once there is output to show, and keeps it
  // after the command ends until the call's result replaces this tail.
  const shown = hasOutput && status !== 'unavailable'
  return (
    <div
      ref={frameRef}
      className={cn('ml-6', shown ? 'py-1' : 'h-0 overflow-hidden')}
      aria-hidden={shown ? undefined : true}
    >
      <div className="overflow-hidden rounded-lg border border-chat-code-border bg-chat-code-surface">
        <div
          ref={terminalRef}
          role="log"
          aria-label={t(
            'components.native-chat.commandOutput.liveLabel',
            'Live output of {{value0}}',
            {
              value0: label
            }
          )}
          className="p-2"
        />
      </div>
    </div>
  )
}

function OverCapButton({ onOpen }: { onOpen: () => void }): React.JSX.Element | null {
  const t = useTranslate()
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), OVER_CAP_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [])
  if (!revealed) {
    return null
  }
  return (
    <div className="ml-6 py-0.5">
      <Button type="button" variant="ghost" size="xs" onClick={onOpen}>
        <SquareTerminal aria-hidden />
        {t('components.native-chat.commandOutput.showLive', 'Show live output')}
      </Button>
    </div>
  )
}
