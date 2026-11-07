'use client'

import { useSyncExternalStore } from 'react'
import { getSyncSnapshot, subscribeSync, type SyncSnapshot } from '@/lib/offline'

/** Live sync state: online/offline, queued changes, replay activity and
 *  whether the current view is the cached snapshot. Updates push renders
 *  (online/offline transitions, queue drains). */
export function useSyncState(): SyncSnapshot {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot)
}
