'use client'

import { useState } from 'react'
import { Check, Download, FileJson, Moon, Palette } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import { useUpdateSettings } from '@/hooks/use-auth'
import { todayDayKey } from '@/lib/app-time'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export const THEME_OPTIONS: {
  key: string
  label: string
  hint: string
  swatch: [string, string, string] // bg, card, accent
}[] = [
  { key: 'paper', label: 'Paper', hint: 'Warm light', swatch: ['#faf9f7', '#ffffff', '#10b981'] },
  { key: 'meadow', label: 'Meadow', hint: 'Fresh light', swatch: ['#f2f7f0', '#fdfffc', '#10b04a'] },
  { key: 'blossom', label: 'Blossom', hint: 'Soft light', swatch: ['#faf2f2', '#fffbfb', '#e11d48'] },
  { key: 'charcoal', label: 'Charcoal', hint: 'Warm dark', swatch: ['#2b2926', '#383531', '#34d399'] },
  { key: 'forest', label: 'Forest', hint: 'Deep green dark', swatch: ['#1f2b22', '#28382b', '#4ade80'] },
  { key: 'sunset', label: 'Sunset', hint: 'Warm amber dark', swatch: ['#2e2620', '#3a3028', '#fbbf24'] },
]

/** Picks that live on the account (synced to every device): apply locally
 *  right away, save in the background. */
function useThemePick() {
  const { setTheme } = useTheme()
  const saveSettings = useUpdateSettings()
  return (key: string) => {
    setTheme(key)
    saveSettings.mutate(
      { theme: key },
      {
        onError: (err) =>
          toast.error('Could not save your theme', {
            description: `${err.message} — it still applies on this device.`,
          }),
      },
    )
  }
}

export function ThemePicker() {
  const { theme } = useTheme()
  const pick = useThemePick()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme" className="relative">
          <Palette className="h-4.5 w-4.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
          <Moon className="h-3.5 w-3.5" /> Theme
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onClick={() => pick(t.key)}
            className="gap-2.5"
            aria-checked={theme === t.key}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
              style={{ background: t.swatch[0], borderColor: t.swatch[1] }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.swatch[2] }} />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.hint}</span>
            </span>
            {theme === t.key && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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

/** Small inline theme swatch row (used in the empty state / footer). */
export function ThemeQuickRow({ className }: { className?: string }) {
  const { theme } = useTheme()
  const pick = useThemePick()
  return (
    <div className={cn('flex items-center gap-1.5', className)} role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="radio"
          aria-checked={theme === t.key}
          aria-label={`${t.label} theme`}
          title={`${t.label} — ${t.hint}`}
          onClick={() => pick(t.key)}
          className={cn(
            'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
            theme === t.key ? 'border-foreground/70 scale-110' : 'border-transparent',
          )}
          style={{ background: t.swatch[0], boxShadow: `inset 0 0 0 3px ${t.swatch[2]}` }}
        />
      ))}
    </div>
  )
}
