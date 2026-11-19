import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { recomputeOn } from '@/lib/recompute-on'
import { AgentStateDot } from '@/components/agent/status/AgentStateDot'
import type { NativeChatBackgroundTaskBlock } from '../../../../../../shared/native-chat/native-chat-types'
import { nativeChatBackgroundTaskRun } from '../../../../../../shared/native-chat/transcript/turns/native-chat-background-task-run'
import { sayBackgroundTaskTranslated } from './background-task-words-text'
import { KIND_ICONS } from './NativeChatBackgroundTasksStatus'
import { useNativeChatCommandOutputScope } from '../../commands/native-chat-command-output-context'

export function NativeChatBackgroundTaskRun({
  block
}: {
  block: NativeChatBackgroundTaskBlock
}): React.JSX.Element {
  const t = useTranslate()
  // The sayer reads translate(); key the row on `t` so its words follow the UI language.
  const row = recomputeOn([t], () =>
    nativeChatBackgroundTaskRun(block, sayBackgroundTaskTranslated)
  )
  const Icon = KIND_ICONS[row.kind]
  const commandOutput = useNativeChatCommandOutputScope()
  // Only a command whose host streams its output opens; any other row stays plain text.
  const openable = commandOutput?.readable.has(block.taskId) === true
  const heading = (
    <>
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-chat-foreground-faint" />
      <AgentStateDot state={row.state} size="sm" title={null} />
      <span className="min-w-0 truncate text-chat-foreground" title={row.label}>
        {row.label}
      </span>
      <span className="ml-auto shrink-0 font-sans text-xs tabular-nums text-chat-foreground-faint">
        {row.status}
      </span>
    </>
  )
  return (
    <div className="min-w-0 py-0.5 font-sans text-sm leading-relaxed text-chat-foreground-faint">
      {openable ? (
        <button
          type="button"
          className="-mx-1 flex min-h-6 w-[calc(100%+0.5rem)] min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 text-left hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={t(
            'components.native-chat.backgroundTasks.openCommandOutput',
            'Show output of {{value0}}',
            { value0: row.label }
          )}
          onClick={() => commandOutput?.open(block.taskId, row.label)}
        >
          {heading}
        </button>
      ) : (
        <div className="flex min-h-6 min-w-0 items-center gap-1.5">{heading}</div>
      )}
      {row.sentence === null ? null : (
        <p className={cn('mt-0.5 pl-7 text-xs', row.state === 'blocked' && 'text-destructive')}>
          {row.sentence}
        </p>
      )}
      {row.output === null ? null : (
        <p className="mt-0.5 truncate pl-7 font-mono text-xs text-chat-foreground-faint">
          {row.output}
        </p>
      )}
    </div>
  )
}
