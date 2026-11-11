'use client'

import { useState } from 'react'
import { Download, FileJson } from 'lucide-react'
import { toast } from 'sonner'
import { todayDayKey } from '@/lib/app-time'
import { Button } from '@/components/ui/button'

/**
 * Header import/export actions. The theme itself lives in the Settings
 * dialog's Appearance tab (src/components/app/appearance/) — one place for
 * the whole look of the app, on purpose.
 */

/** Download the JSON export (shared by the header button and the mobile
 *  account-menu item — the header buttons are hidden below sm). */
export async function exportData() {
  try {
    // fetch with the identity token (a plain link can't carry it)
    const { apiBlob } = await import('@/lib/api-client')
    const blob = await apiBlob('/api/export')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `momentum-roadmap-${todayDayKey()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    toast.error('Could not export your data', { description: e instanceof Error ? e.message : undefined })
  }
}

export function ExportButton() {
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    if (busy) return
    setBusy(true)
    await exportData()
    setBusy(false)
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={busy}
      className="hidden gap-1.5 sm:inline-flex"
      aria-label="Export your data as JSON"
    >
      <Download className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Export</span>
    </Button>
  )
}

export function ImportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="hidden gap-1.5 sm:inline-flex"
      aria-label="Import a roadmap from JSON"
    >
      <FileJson className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Import</span>
    </Button>
  )
}
