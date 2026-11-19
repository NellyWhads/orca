import { createContext } from 'react'

/** Whether the transcript layer holding a live tail is shown: one under an open view is hidden but still
 *  intersects the viewport, so on-screen checks alone would keep it polling. */
export const NativeChatLiveTailVisibleContext = createContext(true)
