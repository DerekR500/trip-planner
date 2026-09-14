import { useCallback, useEffect, useRef, useState } from 'react'

import type { ClientMessage, ServerMessage } from '../../../shared/protocol'

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3000'

/** Backoff bounds. First retry ~0.5s, doubling, never waiting longer than 10s. */
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000

export type SocketStatus = 'connecting' | 'open' | 'reconnecting'

/**
 * Keeps one websocket open for a trip and re-establishes it when the connection drops.
 *
 * The browser's WebSocket does NOT reconnect on its own — once it closes it stays closed —
 * so the reconnect loop below is the whole reason this hook exists. On every (re)connect it
 * re-sends presence:hello, and the server answers with a fresh trip:state, which resyncs
 * anything that changed while we were away.
 */
export function useTripSocket(
  tripId: string | undefined,
  displayName: string,
  onMessage: (message: ServerMessage) => void,
) {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)

  // Latest callback without making it an effect dependency — otherwise every render of
  // the parent would tear down and rebuild the connection.
  const onMessageRef = useRef(onMessage)
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    if (!tripId || !displayName) return

    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    // Distinguishes "React unmounted us" from "the network dropped"; only the latter
    // should trigger a reconnect.
    let disposed = false

    function connect() {
      const socket = new WebSocket(WS_URL)
      socketRef.current = socket

      socket.addEventListener('open', () => {
        retries = 0
        setStatus('open')
        socket.send(JSON.stringify({ type: 'presence:hello', tripId, displayName }))
      })

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        onMessageRef.current(JSON.parse(event.data) as ServerMessage)
      })

      socket.addEventListener('close', () => {
        if (disposed) return
        setStatus('reconnecting')
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** retries, RECONNECT_MAX_MS)
        retries += 1
        retryTimer = setTimeout(connect, delay)
      })

      // An error is always followed by a close, which is where reconnection is handled.
      socket.addEventListener('error', () => undefined)
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [tripId, displayName])

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }, [])

  return { status, send }
}
