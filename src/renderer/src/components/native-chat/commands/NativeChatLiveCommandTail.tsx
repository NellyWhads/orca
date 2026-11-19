import { use, useEffect, useId, useRef } from 'react'
import { SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useNativeChatCommandOutputScope } from './native-chat-command-output-context'
import { useNativeChatCommandTail } from './native-chat-command-tail-store'
import { useNativeChatLiveTailSlot } from './native-chat-live-tail-slots'
import { NativeChatLiveTailVisibleContext } from './native-chat-live-tail-visibility'
import type { NativeChatCommandOutputSink } from './native-chat-command-output-poll'
import { useNativeChatCommandTerminal } from './use-native-chat-command-terminal'
import { useNativeChatOnScreen } from './use-native-chat-on-screen'

const TAIL_SCROLLBACK_ROWS = 500
// One height for terminal and placeholder alike, so a row never changes size when a slot comes or goes.
const TAIL_FRAME_CLASS =
  'h-36 overflow-hidden rounded-lg border border-chat-code-border bg-chat-code-surface'

/** A running foreground command's output under its call row, until its result replaces it. */
export function NativeChatLiveCommandTail({
  toolUseId,
  label,
  captioned = false
}: {
  toolUseId: string
  label: string
  /** Under a collapsed run no row names the command, so the tail does. */
  captioned?: boolean
}): React.JSX.Element | null {
  const scope = useNativeChatCommandOutputScope()
  return scope ? (
    <LiveTail toolUseId={toolUseId} label={label} captioned={captioned} scope={scope} />
  ) : null
}

function LiveTail({
  toolUseId,
  label,
  captioned,
  scope
}: {
  toolUseId: string
  label: string
  captioned: boolean
  scope: NonNullable<ReturnType<typeof useNativeChatCommandOutputScope>>
}): React.JSX.Element {
  const t = useTranslate()
  const anchorRef = useRef<HTMLDivElement>(null)
  const layerVisible = use(NativeChatLiveTailVisibleContext)
  const onScreen = useNativeChatOnScreen(anchorRef)
  const active = layerVisible && onScreen
  const { snapshot, attach } = useNativeChatCommandTail({
    target: scope.target,
    sessionId: scope.sessionId,
    toolUseId,
    active
  })
  const shown = snapshot.hasOutput
  const claimId = useId()
  const hasSlot = useNativeChatLiveTailSlot(
    `${claimId}:${toolUseId}`,
    shown && active && snapshot.status !== 'unavailable'
  )
  // Nothing renders, and nothing can take focus, until there is output; the anchor alone is observed.
  return (
    <div ref={anchorRef} className="ml-6">
      {shown ? (
        <div className="py-1">
          {captioned ? (
            <p
              className="truncate pb-0.5 font-mono text-xs text-chat-foreground-faint"
              title={label}
            >
              {label}
            </p>
          ) : null}
          {hasSlot ? (
            <TailTerminal attach={attach} label={label} />
          ) : (
            <div className={`${TAIL_FRAME_CLASS} flex items-center justify-center`}>
              {snapshot.status === 'unavailable' ? (
                <p className="text-xs text-chat-foreground-faint">
                  {t(
                    'components.native-chat.commandOutput.tailStopped',
                    'Live output is no longer available.'
                  )}
                </p>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => scope.openToolCall(toolUseId, label)}
                >
                  <SquareTerminal aria-hidden />
                  {t('components.native-chat.commandOutput.showLive', 'Show live output')}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function TailTerminal({
  attach,
  label
}: {
  attach: (terminal: NativeChatCommandOutputSink) => () => void
  label: string
}): React.JSX.Element {
  const t = useTranslate()
  const terminalRef = useRef<HTMLDivElement>(null)
  const sink = useNativeChatCommandTerminal(terminalRef, {
    scrollback: TAIL_SCROLLBACK_ROWS,
    codeFont: true
  })
  const attachRef = useRef(attach)
  useEffect(() => {
    attachRef.current = attach
  })
  useEffect(() => (sink ? attachRef.current(sink) : undefined), [sink])
  return (
    <div className={TAIL_FRAME_CLASS}>
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
        className="h-full p-2 font-mono text-chat-code"
      />
    </div>
  )
}
