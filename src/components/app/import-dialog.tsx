'use client'

import { useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, ClipboardPaste, FileJson, FileUp, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  IMPORT_EXAMPLE_JSON,
  describeImport,
  parseImportFile,
  type NormalizedImport,
} from '@/lib/import-format'
import { useImportGoals } from '@/hooks/use-goals'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Stage = 'input' | 'preview'

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [stage, setStage] = useState<Stage>('input')
  const [raw, setRaw] = useState('')
  const [parsed, setParsed] = useState<NormalizedImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showExample, setShowExample] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importGoals = useImportGoals()

  function reset() {
    setStage('input')
    setRaw('')
    setParsed(null)
    setError(null)
  }

  /** Parse the given text; on success move to the preview stage. */
  function tryParse(text: string) {
    setError(null)
    try {
      const json = JSON.parse(text)
      const p = parseImportFile(json)
      setParsed(p)
      setStage('preview')
    } catch (e) {
      setStage('input')
      setError(e instanceof Error ? e.message : 'Invalid JSON — could not parse the text')
    }
  }

  function handleParse() {
    if (!raw.trim()) return
    tryParse(raw)
  }

  function handleFile(file: File | null | undefined) {
    if (!file) return
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      setError('Please choose a .json file')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setRaw(text)
      tryParse(text)
    }
    reader.onerror = () => setError('Could not read the file')
    reader.readAsText(file)
  }

  function handleImport() {
    if (!parsed) return
    importGoals.mutate(JSON.parse(raw), {
      onSuccess: (res) => {
        toast.success(`Imported ${res.created} goal${res.created === 1 ? '' : 's'}`, {
          description: 'Roadmap, routines and skill maps are ready to go.',
        })
        onOpenChange(false)
        reset()
      },
      onError: (e) => {
        setError(e.message)
      },
    })
  }

  const stats = parsed ? describeImport(parsed) : null

  const errorBox = error && (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{error}</span>
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5 sm:px-6">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <FileJson className="h-5 w-5 shrink-0 text-primary" /> Import a roadmap
          </DialogTitle>
          <DialogDescription>
            Paste or upload a JSON roadmap — goals, plan steps, skill paths with checkpoints &amp; sub-checkpoints,
            locked progression (requires), per-day routines and flexible weekly quotas are all created for you.
          </DialogDescription>
        </DialogHeader>

        {/* scrollable body — the dialog itself never grows past the screen */}
        <div className="nice-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {stage === 'input' && (
            <div className="space-y-4">
              {/* upload */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <FileUp className="h-5 w-5" />
                <span className="text-sm font-medium">Choose a .json file</span>
                <span className="text-xs">or paste the JSON below</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="JSON roadmap file"
                onChange={(e) => {
                  handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />

              {/* paste */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Paste JSON</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText()
                          if (text) {
                            setRaw(text)
                            tryParse(text)
                          }
                        } catch {
                          toast.error('Clipboard unavailable — paste manually (Ctrl/Cmd+V), then Parse')
                        }
                      }}
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" /> Paste &amp; parse
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowExample(!showExample)}>
                      <Sparkles className="h-3.5 w-3.5" /> Example
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showExample && 'rotate-180')} />
                    </Button>
                  </div>
                </div>
                {/* the textarea scrolls on its own — it never stretches the dialog */}
                <Textarea
                  value={raw}
                  onChange={(e) => {
                    setRaw(e.target.value)
                    setError(null)
                  }}
                  placeholder='{ "version": 1, "goals": [ … ] }'
                  className="nice-scroll h-44 max-h-[42dvh] min-h-28 resize-none font-mono text-xs leading-relaxed"
                  spellCheck={false}
                  aria-label="JSON roadmap"
                />
              </div>

              {showExample && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">Format reference (a language-learning skill map)</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(IMPORT_EXAMPLE_JSON)
                          .then(() => toast.success('Example copied'))
                          .catch(() => toast.error('Copy failed'))
                      }}
                    >
                      Copy example
                    </Button>
                  </div>
                  <pre className="nice-scroll max-h-52 overflow-auto rounded-xl border bg-muted/40 p-3 font-mono text-[10.5px] leading-relaxed">
                    {IMPORT_EXAMPLE_JSON}
                  </pre>
                </div>
              )}
            </div>
          )}

          {stage === 'preview' && parsed && stats && (
            <div className="space-y-4">
              {/* stats */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {[
                  { label: 'Goals', value: stats.goals },
                  { label: 'Steps', value: stats.steps },
                  { label: 'Paths', value: stats.paths },
                  { label: 'Checkpoints', value: stats.nodes },
                  { label: 'Sub-★', value: stats.milestones },
                  { label: 'Routines', value: stats.routines },
                  { label: 'History', value: stats.history },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border bg-card p-3 text-center">
                    <div className="text-xl font-bold tabular-nums text-primary">{s.value}</div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* goal list */}
              <div className="space-y-2">
                {parsed.goals.map((g, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                    <span className="shrink-0 text-xl">{g.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{g.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {g.category ? `${g.category} · ` : ''}
                        {g.type === 'quantitative' ? `target ${g.targetValue} ${g.unit ?? ''}` : 'plan'}
                        {g.paths.length > 0 &&
                          ` · ${g.paths.length} paths · ${g.paths.reduce((s, p) => s + p.nodes.length, 0)} checkpoints`}
                        {g.paths.some((p) => p.nodes.some((n) => n.milestones.length > 0)) &&
                          ` · ${g.paths.reduce((s, p) => s + p.nodes.reduce((y, n) => y + n.milestones.length, 0), 0)} sub-★`}
                        {g.routines.length > 0 && ` · ${g.routines.length} routines`}
                        {g.deadline && ` · by ${new Date(g.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* pinned footer — always reachable, no scrolling past the JSON to find it */}
        <div className="shrink-0 space-y-3 border-t bg-background px-5 py-3.5 sm:px-6">
          {errorBox}
          <DialogFooter className="gap-2 sm:justify-end">
            {stage === 'input' ? (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleParse} disabled={!raw.trim()}>
                  Parse JSON
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStage('input')}>
                  Back
                </Button>
                <Button onClick={handleImport} disabled={importGoals.isPending}>
                  {importGoals.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" /> Import {stats?.goals} goal{stats?.goals === 1 ? '' : 's'}
                    </>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
