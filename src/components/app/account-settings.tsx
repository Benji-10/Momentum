'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Globe, KeyRound, Loader2, MapPin, RotateCcw, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import { useUpdateIdentityProfile, useUpdateSettings } from '@/hooks/use-auth'
import { useDangerAction } from '@/hooks/use-goals'
import type { UserSettings } from '@/lib/settings'
import {
  clockLabel,
  listTimezones,
  setAppTimezone,
  systemTimezone,
  tzOffsetLabel,
} from '@/lib/app-time'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { THEME_OPTIONS } from '@/components/app/theme-picker'
import { cn } from '@/lib/utils'

/** "America/Chicago" → "Chicago" */
function cityOf(tz: string): string {
  const last = tz.split('/').pop() ?? tz
  return last.replace(/_/g, ' ')
}

/** "America/Chicago" → "America" */
function regionOf(tz: string): string {
  return tz.split('/')[0] ?? tz
}

// ---------------------------------------------------------------------------
// Timezone picker — searchable list of IANA zones + "automatic" (this device)
// ---------------------------------------------------------------------------

function TimezonePicker({
  value,
  saving,
  onPick,
}: {
  /** null = automatic; undefined = still loading */
  value: string | null | undefined
  saving: boolean
  onPick: (tz: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const systemTz = useMemo(() => systemTimezone(), [])
  const zones = useMemo(() => listTimezones(), [])

  const effective = value ?? systemTz
  const preview = useMemo(() => {
    const tz = value ?? systemTz
    return `Right now it's ${clockLabel(tz)} (${tzOffsetLabel(tz)}) — days roll over at midnight in ${cityOf(tz)}.`
  }, [value, systemTz])

  // group matching zones by region, keeping the IANA order
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/_/g, ' ')
    const matches = zones.filter((tz) => {
      const hay = `${tz} ${cityOf(tz)}`.toLowerCase().replace(/_/g, ' ')
      return !q || hay.includes(q)
    })
    const out: { region: string; zones: string[] }[] = []
    for (const tz of matches) {
      const region = regionOf(tz)
      const g = out.find((x) => x.region === region)
      if (g) g.zones.push(tz)
      else out.push({ region, zones: [tz] })
    }
    return out
  }, [zones, query])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="tz-picker">Day starts in</Label>
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
          <PopoverTrigger asChild>
            <Button
              id="tz-picker"
              variant="outline"
              size="sm"
              className="max-w-full justify-between gap-2 font-normal"
              aria-label="Change time zone"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {value == null ? 'Automatic' : cityOf(value)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {value == null ? `· ${systemTz}` : `· UTC${tzOffsetLabel(value).slice(3)}`}
                </span>
              </span>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="end">
            <Command>
              <CommandInput placeholder="Search city or zone…" value={query} onValueChange={setQuery} />
              <CommandList className="max-h-72">
                <CommandEmpty>No time zone matches.</CommandEmpty>
                <CommandGroup heading="This device">
                  <CommandItem
                    value={`auto ${systemTz}`}
                    onSelect={() => {
                      onPick(null)
                      setOpen(false)
                    }}
                    className="gap-2"
                  >
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">Automatic</span>
                      <span className="block text-xs text-muted-foreground">
                        Each device uses its own clock — currently {systemTz}
                      </span>
                    </span>
                    {value == null && <Check className="h-4 w-4 text-primary" />}
                  </CommandItem>
                </CommandGroup>
                {groups.map((g) => (
                  <CommandGroup key={g.region} heading={g.region}>
                    {g.zones.map((tz) => (
                      <CommandItem
                        key={tz}
                        value={`${tz} ${cityOf(tz)}`}
                        onSelect={() => {
                          onPick(tz)
                          setOpen(false)
                        }}
                        className="gap-2"
                      >
                        <span className="flex-1">
                          <span className="block text-sm font-medium">{cityOf(tz)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {tz} · {tzOffsetLabel(tz)} · now {clockLabel(tz)}
                          </span>
                        </span>
                        {value === tz && <Check className="h-4 w-4 text-primary" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {value == null
          ? `Automatic — right now it's ${clockLabel(effective)} (${effective}). Days roll over at midnight on each device.`
          : preview}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Theme grid — the six swatches, saving to the account
// ---------------------------------------------------------------------------

function ThemeGrid({ onPick }: { onPick: (key: string) => void }) {
  const { theme } = useTheme()
  return (
    <div className="grid grid-cols-3 gap-2">
      {THEME_OPTIONS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          aria-pressed={theme === t.key}
          className={cn(
            'flex items-center gap-2 rounded-lg border p-2 text-left transition-colors',
            theme === t.key ? 'border-primary bg-primary/10' : 'hover:border-primary/40',
          )}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
            style={{ background: t.swatch[0], borderColor: t.swatch[1] }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.swatch[2] }} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{t.label}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{t.hint}</span>
          </span>
          {theme === t.key && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Danger zone — reset progress / wipe everything, behind a typed word
// ---------------------------------------------------------------------------

type DangerAction = 'reset-progress' | 'wipe-all'

const DANGER_META: Record<
  DangerAction,
  { word: string; title: string; button: string; body: string; effects: string[] }
> = {
  'reset-progress': {
    word: 'RESET',
    title: 'Reset all progress?',
    button: 'Reset progress',
    body: 'Every value goes back to zero, but the roadmap itself stays exactly as it is.',
    effects: [
      'All checkpoints reset to 0 / target — sub-★ and clear dates cleared',
      'All check-offs, practice logs and PB records deleted',
      'Steps go back to pending',
      'Goals, branches, checkpoints, routines, PB metrics and notes are kept',
    ],
  },
  'wipe-all': {
    word: 'WIPE',
    title: 'Delete everything?',
    button: 'Delete everything',
    body: 'Permanently removes every goal and everything under it. There is no undo.',
    effects: [
      'All goals, branches, checkpoints, routines and PB metrics deleted',
      'All progress, history, check-offs, steps and notes deleted',
      'Your account, password and these settings stay',
      'Consider exporting a backup first — deleted data cannot be recovered',
    ],
  },
}

function DangerZone() {
  const [confirming, setConfirming] = useState<DangerAction | null>(null)
  const [word, setWord] = useState('')
  const danger = useDangerAction()
  const meta = confirming ? DANGER_META[confirming] : null

  function run() {
    if (!confirming || !meta) return
    danger.mutate(
      { action: confirming, confirm: word },
      {
        onSuccess: (_res, vars) => {
          if (vars.action === 'wipe-all') {
            toast.success('Everything deleted — fresh start!', {
              description: 'Your account and settings are untouched. Import a roadmap to begin again.',
            })
          } else {
            const s = _res.stats
            toast.success('Progress reset', {
              description: [
                s.nodesReset ? `${s.nodesReset} checkpoints` : null,
                s.routines ? `${s.routines} routines` : null,
                s.donesDeleted ? `${s.donesDeleted} check-offs` : null,
                s.logsDeleted ? `${s.logsDeleted} logs` : null,
                s.pbRecordsCleared ? `${s.pbRecordsCleared} PB records` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing to reset yet.',
            })
          }
          setConfirming(null)
          setWord('')
        },
        onError: (err) => toast.error('Action failed', { description: err.message }),
      },
    )
  }

  return (
    <>
      <section className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Danger zone
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Reset all progress</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Back to zero everywhere — keeps your goals, skill trees, routines and PB metrics.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              setConfirming('reset-progress')
              setWord('')
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset…
          </Button>
        </div>

        <div className="h-px bg-destructive/20" />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Delete everything</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Permanently deletes every goal, branch, routine and record. Your account and settings stay.
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setConfirming('wipe-all')
              setWord('')
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete all…
          </Button>
        </div>
      </section>

      {/* confirmation — typing the word is the point */}
      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(null)
            setWord('')
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {meta?.title}
            </DialogTitle>
            <DialogDescription>{meta?.body}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {meta?.effects.map((e) => (
              <li key={e} className="flex items-start gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive/60" />
                {e}
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="danger-word">
              Type <span className="font-mono font-semibold text-destructive">{meta?.word}</span> to confirm
            </Label>
            <Input
              id="danger-word"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder={meta?.word}
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!meta || word.trim().toUpperCase() !== meta.word || danger.isPending}
              onClick={run}
            >
              {danger.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : confirming === 'wipe-all' ? <Trash2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
              {meta?.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

/**
 * Settings for the signed-in account: app preferences (theme + the time zone
 * "today" is based on — both saved to the account and synced to every device)
 * and the Netlify Identity account behind the custom UX (name + password).
 */
export function SettingsDialog({
  open,
  onOpenChange,
  name,
  settings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string | null
  /** the user's synced settings (null = signed out / still loading) */
  settings: UserSettings | null
}) {
  const [newName, setNewName] = useState(name ?? '')
  const [password, setPassword] = useState('')
  // pending overrides the server value until the save settles (optimistic UX)
  const [pendingTz, setPendingTz] = useState<string | null | undefined>(undefined)
  const update = useUpdateIdentityProfile()
  const saveSettings = useUpdateSettings()
  const { setTheme } = useTheme()

  const tzValue = pendingTz !== undefined ? pendingTz : (settings?.timezone ?? null)

  function pickTheme(key: string) {
    setTheme(key) // instant, cached to this device's localStorage by next-themes
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

  function pickTimezone(tz: string | null) {
    setPendingTz(tz)
    setAppTimezone(tz) // instant local preview of the new "today"
    saveSettings.mutate(
      { timezone: tz },
      {
        onError: (err) => {
          setPendingTz(undefined)
          setAppTimezone(settings?.timezone ?? null) // revert to the synced value
          toast.error('Could not save your time zone', { description: err.message })
        },
      },
    )
  }

  function save(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = newName.trim()
    if (update.isPending) return
    if (!trimmed && !password) {
      toast('Nothing to update')
      return
    }
    if (password && password.length < 8) {
      toast.error('New password needs at least 8 characters')
      return
    }
    update.mutate(
      {
        ...(trimmed ? { name: trimmed } : {}),
        ...(password ? { password } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Account updated')
          setPassword('')
          onOpenChange(false)
        },
        onError: (err) => toast.error('Could not update account', { description: err.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Preferences sync to your account — every device agrees on the look and on what &ldquo;today&rdquo; means.
          </DialogDescription>
        </DialogHeader>

        {/* ── app preferences ── */}
        <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preferences</div>
            <p className="text-[11px] text-muted-foreground">
              Applied instantly — no save button needed.
            </p>
          </div>

          <ThemeGrid onPick={pickTheme} />

          <div className="h-px bg-border" />

          <TimezonePicker value={tzValue} saving={saveSettings.isPending && pendingTz !== undefined} onPick={pickTimezone} />

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Pick the zone your days actually happen in — e.g. your laptop may still be set to{' '}
            {systemTimezone()}, but if you live in Texas, choose <span className="font-medium">America/Chicago</span>{' '}
            so the app never shows tomorrow&apos;s tasks early.
          </p>
        </section>

        {/* ── account ── */}
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Account
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="acct-name">Display name</Label>
            <Input
              id="acct-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Alex"
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acct-password">
              New password <span className="text-muted-foreground">(leave blank to keep)</span>
            </Label>
            <Input
              id="acct-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : password ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <UserRound className="h-4 w-4" />
              )}
              Save account
            </Button>
          </div>
        </form>

        {/* ── danger zone ── */}
        <DangerZone />
      </DialogContent>
    </Dialog>
  )
}
