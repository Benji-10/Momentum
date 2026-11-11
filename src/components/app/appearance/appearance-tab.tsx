'use client'

// ---------------------------------------------------------------------------
// The Appearance tab of Settings — one place for the whole look of the app.
//
//   Colour theme   14 palette previews + a Custom card with a full colour
//                  editor (pickers, hex inputs, start-from-preset)
//   Background     library with category filters and live thumbnails, the
//                  relevant settings for the chosen one, and your own
//                  uploaded image (opacity / darkness / tint / fit /
//                  position / scale / blur)
//   Surfaces       solid · translucent · glass
//   Resets         per-section + full reset
//
// Every change applies instantly (AppearanceProvider) and saves to the
// account in the background — there is no save button.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react'
import { Blend, Droplets, Image as ImageIcon, Layers, Minus, Palette, RotateCcw, Square, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BACKGROUND_POSITIONS, BACKGROUNDS, BACKGROUND_CATEGORY_LABELS, backgroundDef, type BackgroundCategory } from '@/lib/appearance/backgrounds'
import { CUSTOM_THEME_KEYS, type CustomTheme } from '@/lib/appearance/types'
import { useAppearance, DEFAULT_CUSTOM } from './AppearanceProvider'
import { BackgroundTile, CustomImageTile, CustomThemeCard, getPaletteAsCustom, ThemePreviewCard, ALL_PALETTES } from './previews'
import { BgSlider, ColorField, SectionLabel, Segmented } from './controls'

const CUSTOM_LABELS: Record<keyof CustomTheme, string> = {
  background: 'Background',
  surface: 'Surface',
  surfaceAlt: 'Secondary surface',
  border: 'Border',
  text: 'Text',
  textMuted: 'Muted text',
  primary: 'Primary accent',
  accent2: 'Secondary accent',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
}

const TINT_CHOICES = ['#7c6ee0', '#10b981', '#f59e0b', '#e11d48', '#38bdf8', '#f8fafc', '#0f172a']

// ---------------------------------------------------------------------------
// Custom palette editor
// ---------------------------------------------------------------------------

function CustomThemeEditor() {
  const { appearance, setCustomColors } = useAppearance()
  const colors = appearance.custom ?? DEFAULT_CUSTOM
  const [startFrom, setStartFrom] = useState<string>('')

  function patch(key: keyof CustomTheme, hex: string) {
    setCustomColors({ ...colors, [key]: hex })
  }

  function startFromPreset(key: string) {
    setStartFrom(key)
    if (!key) return
    const read = getPaletteAsCustom(key)
    if (read) {
      setCustomColors(read)
      toast.success(`Started from ${ALL_PALETTES.find((p) => p.key === key)?.label ?? key}`, {
        description: 'Every colour is now yours to tweak.',
      })
    } else {
      toast.error('Could not read that palette', { description: 'Your browser blocked colour conversion — colours unchanged.' })
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom colours</div>
        <div className="flex items-center gap-2">
          <Select value={startFrom} onValueChange={startFromPreset}>
            <SelectTrigger className="h-7 w-40 text-xs" aria-label="Start from a preset">
              <SelectValue placeholder="Start from a preset…" />
            </SelectTrigger>
            <SelectContent>
              {ALL_PALETTES.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setCustomColors({ ...DEFAULT_CUSTOM })}>
            <RotateCcw className="h-3 w-3" /> Reset colours
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {CUSTOM_THEME_KEYS.map((k) => (
          <ColorField key={k} label={CUSTOM_LABELS[k]} value={colors[k]} onChange={(hex) => patch(k, hex)} />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Text on coloured fills (buttons, badges) picks black or white automatically for contrast.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom image panel (upload + its settings)
// ---------------------------------------------------------------------------

function CustomImagePanel() {
  const { appearance, customImage, customImageMissing, uploadCustomImage, removeCustomImage, updateBackgroundSettings } = useAppearance()
  const fileRef = useRef<HTMLInputElement>(null)
  const s = appearance.background?.settings ?? {}

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your image</div>
        {customImage && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={removeCustomImage}>
            <X className="h-3 w-3" /> Remove
          </Button>
        )}
      </div>

      {customImage ? (
        <div className="flex items-center gap-3">
          <div
            className="h-14 w-24 shrink-0 rounded-lg border bg-muted/40"
            style={{ backgroundImage: `url(${customImage.url})`, backgroundSize: 'cover', backgroundPosition: String(s.position ?? 'center') }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{customImage.name}</div>
            <div className="text-[11px] text-muted-foreground">Stored on this device — not synced.</div>
            <Button variant="outline" size="sm" className="mt-1.5 h-7 px-2 text-xs" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3 w-3" /> Replace
            </Button>
          </div>
        </div>
      ) : customImageMissing ? (
        <div className="rounded-lg border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground">
            No image on this device yet — uploads stay in this browser, so pick it here too.
          </p>
          <Button variant="outline" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3 w-3" /> Upload here
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Upload className="h-4 w-4" />
          <span className="text-xs font-medium">Upload an image</span>
          <span className="text-[10px]">PNG, JPG or WebP · up to 8 MB · stays on this device</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="Upload a background image"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) uploadCustomImage(f)
          e.target.value = ''
        }}
      />

      {customImage && (
        <div className="space-y-3">
          <BgSlider label="Opacity" value={Number(s.opacity ?? 100)} min={5} max={100} suffix="%" onCommit={(v) => updateBackgroundSettings({ opacity: v })} />
          <BgSlider label="Darkness" value={Number(s.darkness ?? 25)} min={0} max={90} suffix="%" onCommit={(v) => updateBackgroundSettings({ darkness: v })} />
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Tint</div>
            <div className="flex items-center gap-1.5">
              {TINT_CHOICES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-label={`Tint ${t}`}
                  onClick={() => updateBackgroundSettings({ tint: t })}
                  className={cn('h-6 w-6 rounded-full border-2', String(s.tint ?? '#7c6ee0') === t ? 'border-primary' : 'border-transparent')}
                  style={{ background: t }}
                />
              ))}
            </div>
          </div>
          <BgSlider label="Tint strength" value={Number(s.tintStrength ?? 0)} min={0} max={80} suffix="%" onCommit={(v) => updateBackgroundSettings({ tintStrength: v })} />
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Fit</div>
            <Segmented
              ariaLabel="Image fit"
              value={String(s.fit ?? 'cover')}
              onChange={(v) => updateBackgroundSettings({ fit: v })}
              options={[
                { value: 'cover', label: 'Cover' },
                { value: 'contain', label: 'Contain' },
              ]}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Position</div>
            <div className="grid w-max grid-cols-3 gap-1">
              {BACKGROUND_POSITIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={`Position ${p}`}
                  aria-pressed={String(s.position ?? 'center') === p}
                  onClick={() => updateBackgroundSettings({ position: p })}
                  className={cn(
                    'h-6 w-6 rounded border text-[9px] font-medium transition-colors',
                    String(s.position ?? 'center') === p
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                  title={p}
                >
                  {p === 'center' ? '●' : '•'}
                </button>
              ))}
            </div>
          </div>
          <BgSlider label="Scale" value={Number(s.scale ?? 100)} min={50} max={250} suffix="%" onCommit={(v) => updateBackgroundSettings({ scale: v })} />
          <BgSlider label="Blur" value={Number(s.blur ?? 0)} min={0} max={24} suffix="px" onCommit={(v) => updateBackgroundSettings({ blur: v })} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Background settings panel for a library background
// ---------------------------------------------------------------------------

function BackgroundSettingsPanel() {
  const { appearance, updateBackgroundSettings } = useAppearance()
  const bg = appearance.background
  const def = bg ? backgroundDef(bg.id) : null
  if (!bg || !def) return null

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{def.name} settings</div>
      {def.settings
        .filter((s): s is Extract<typeof s, { kind: 'slider' }> => s.kind === 'slider')
        .map((s) => (
          <BgSlider
            key={s.key}
            label={s.label}
            value={Number(bg.settings[s.key] ?? s.default)}
            min={s.min}
            max={s.max}
            step={s.step ?? 1}
            suffix={s.suffix ?? ''}
            onCommit={(v) => updateBackgroundSettings({ [s.key]: v })}
          />
        ))}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {def.category === 'animated'
          ? 'Animations pause when the tab is hidden and freeze entirely if you prefer reduced motion.'
          : def.category === 'static'
            ? 'The pattern is regenerated when these settings change — never per frame.'
            : 'A procedurally rendered scene — no image download.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

type BgFilter = 'all' | BackgroundCategory

export function AppearanceTab() {
  const { appearance, activeTheme, setTheme, setBackground, setSurface, resetTheme, resetBackground, resetAll, customImage } = useAppearance()
  const [filter, setFilter] = useState<BgFilter>('all')

  const visibleBgs = useMemo(
    () => (filter === 'all' ? BACKGROUNDS : BACKGROUNDS.filter((b) => b.category === filter)),
    [filter],
  )
  const selectedBgId = appearance.background?.id ?? 'none'
  const isCustomImage = selectedBgId === 'custom-image'

  return (
    <div className="space-y-5">
      {/* ── colour themes ── */}
      <section className="space-y-2.5">
        <SectionLabel
          action={
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={resetTheme}>
              Reset
            </button>
          }
        >
          <Palette className="mr-1 inline h-3.5 w-3.5" /> Colour theme
        </SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ALL_PALETTES.map((p) => (
            <ThemePreviewCard key={p.key} meta={p} active={activeTheme === p.key} onClick={() => setTheme(p.key)} />
          ))}
          <CustomThemeCard active={activeTheme === 'custom'} colors={appearance.custom} onClick={() => setTheme('custom')} />
        </div>
        {activeTheme === 'custom' && <CustomThemeEditor />}
      </section>

      {/* ── background ── */}
      <section className="space-y-2.5">
        <SectionLabel
          action={
            selectedBgId !== 'none' ? (
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={resetBackground}>
                Reset
              </button>
            ) : null
          }
        >
          <ImageIcon className="mr-1 inline h-3.5 w-3.5" /> Background
        </SectionLabel>

        {/* none + category filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setBackground(null)}
            aria-pressed={selectedBgId === 'none'}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              selectedBgId === 'none' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40',
            )}
          >
            <Minus className="h-3 w-3" /> None
          </button>
          <span className="mx-1 h-4 w-px bg-border" />
          {(['all', 'animated', 'static', 'image'] as BgFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                filter === f ? 'border-foreground/60 bg-muted' : 'border-transparent text-muted-foreground hover:bg-accent',
              )}
            >
              {f === 'all' ? 'All' : BACKGROUND_CATEGORY_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visibleBgs.map((b) => (
            <BackgroundTile key={b.id} def={b} active={selectedBgId === b.id} onClick={() => setBackground(b.id)} />
          ))}
          {/* your image lives at the end of the grid regardless of filter */}
          {(filter === 'all' || filter === 'image') && (
            <CustomImageTile active={isCustomImage} hasImage={!!customImage} thumbUrl={customImage?.url ?? null} onClick={() => setBackground('custom-image')} />
          )}
        </div>

        {isCustomImage ? (
          <CustomImagePanel />
        ) : selectedBgId !== 'none' ? (
          <BackgroundSettingsPanel />
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Backgrounds are independent of the colour theme — pair any palette with any background. Dark scenes sit
            behind light themes too; lower their opacity if that gets busy.
          </p>
        )}
      </section>

      {/* ── surfaces ── */}
      <section className="space-y-2.5">
        <SectionLabel>Surfaces</SectionLabel>
        <Segmented
          ariaLabel="Surface treatment"
          value={appearance.surface}
          onChange={setSurface}
          options={[
            { value: 'solid', label: 'Solid', icon: Square },
            { value: 'translucent', label: 'Translucent', icon: Layers },
            { value: 'glass', label: 'Glass', icon: Droplets },
          ]}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {appearance.surface === 'solid'
            ? 'Cards and overlays are fully opaque.'
            : appearance.surface === 'translucent'
              ? 'Cards and overlays keep their colour but let the background show through, lightly blurred.'
              : 'Frosted surfaces — see-through cards with a strong blur, best over animated backgrounds.'}
        </p>
      </section>

      {/* ── full reset ── */}
      <section className="border-t pt-3">
        <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={resetAll}>
          <Blend className="h-3.5 w-3.5" /> Reset all appearance to defaults
        </Button>
      </section>
    </div>
  )
}
