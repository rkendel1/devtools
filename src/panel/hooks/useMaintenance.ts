import { useEffect, useRef } from 'react'
import { feltRepository } from '../../lib/feltRepository'
import { MAINTENANCE_INTERVAL_MS, MAX_LIVE_REQUESTS, RETENTION_MS } from '../../lib/retention'
import type { NetworkRequestSnapshot } from '../../lib/types'

export function useMaintenance(
  requestsRef: React.MutableRefObject<NetworkRequestSnapshot[]>,
  setRequests: React.Dispatch<React.SetStateAction<NetworkRequestSnapshot[]>>,
  setSelectedRequestId: React.Dispatch<React.SetStateAction<string>>,
  setLastCleanup: (v: number | null) => void,
  setMessage: (msg: string) => void,
) {
  const lastMaintenanceAt = useRef(0)
  useEffect(() => {
    const maintain = () => void feltRepository.runMaintenance(true).then((result) => {
      const cutoff = Date.now() - RETENTION_MS
      const retained = requestsRef.current.filter((request) => request.startedAt >= cutoff).slice(-MAX_LIVE_REQUESTS)
      if (retained.length !== requestsRef.current.length) {
        requestsRef.current = retained
        setRequests(retained)
        setSelectedRequestId((current) => retained.some((request) => request.id === current) ? current : '')
      }
      if (Object.values(result).some((count) => count > 0)) setLastCleanup(Date.now())
      lastMaintenanceAt.current = Date.now()
    }).catch((error) => setMessage(`Retention maintenance failed: ${String(error)}`))
    const timer = window.setInterval(maintain, MAINTENANCE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [requestsRef, setRequests, setSelectedRequestId, setLastCleanup, setMessage])
}
