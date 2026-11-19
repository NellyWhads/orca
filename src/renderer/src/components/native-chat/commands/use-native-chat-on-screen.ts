import { useEffect, useState } from 'react'

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

/** Whether the element intersects the viewport while its window is visible; polling views pause otherwise. */
export function useNativeChatOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [intersecting, setIntersecting] = useState(false)
  const [visible, setVisible] = useState(documentVisible)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIntersecting(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      setIntersecting(entries.some((entry) => entry.isIntersecting))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  useEffect(() => {
    const update = () => setVisible(documentVisible())
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return intersecting && visible
}
