import { isEditableTarget } from '@/lib/text-input/focus/editable-target'
import { closeNativeChatCommand, isNativeChatCommandOpen } from './native-chat-open-command'

/** Esc outside inputs and menus closes an open command view, back to whatever opened it. */
export function closeNativeChatCommandOnEscape(event: React.KeyboardEvent, paneKey: string): void {
  const target = event.target
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    !isNativeChatCommandOpen(paneKey) ||
    !(target instanceof Element) ||
    // Portaled menus bubble through React but sit outside this pane's DOM.
    !event.currentTarget.contains(target) ||
    isEditableTarget(target) ||
    target.closest('[role="menu"], [role="dialog"], [role="listbox"]') !== null
  ) {
    return
  }
  event.preventDefault()
  closeNativeChatCommand(paneKey)
}
