import { createContext } from 'react'

/** Whether a tail's transcript layer is shown; a layer under an open view still intersects the viewport. */
export const NativeChatLiveTailVisibleContext = createContext(true)
