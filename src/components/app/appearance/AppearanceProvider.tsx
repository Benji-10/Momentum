'use client'

// ---------------------------------------------------------------------------
// AppearanceProvider — the runtime for the look of the app.
//
// Owns three independent choices (see lib/appearance/types.ts):
//   theme (palette or custom) · background (library or upload) · surface
//
// Behaviour:
//  - applies changes to the DOM instantly (live preview), then saves them to
//    the account in the background; the offline settings cache is refreshed
//    too, so a cold PWA boot paints the right look pre-hydration
//  - a local override wins until the server confirms (or rejects) it, so a
//    slow save never reverts the UI; cross-device changes picked up by the
//    settings poll apply automatically
//  - the custom palette is injected as a <style> html[data-theme='custom']
//    block (same variables as any preset); uploaded images live in IndexedDB
//    on this device, keyed per account
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import type { AppearanceSettings, BackgroundConfig, CustomTheme, SurfaceTreatment } from '@/lib/appearance/types'
import { DEFAULT_APPEARANCE } from '@/lib/appearance/types'
import { customThemeCss, isCustomThemeDark, isPaletteKey, migrateThemeKey, paletteMeta } from '@/lib/appearance/palettes'
import { defaultBackgroundConfig } from '@/lib/appearance/backgrounds'
import { useSettings, useMe, useUpdateSettings } from '@/hooks/use-auth'
import { loadSettingsCache, saveSettingsCache } from '@/lib/offline'
import { deleteImage, loadImage, saveImage } from '@/lib/appearance/idb'
import { BackgroundLayer } from './BackgroundLayer'

const CUSTOM_STYLE_ID = 'momentum-custom-theme'

/** Default settings for the uploaded-image background. */
const DEFAULT_CUSTOM_IMAGE_SETTINGS: Record<string, number | string> = {
  opacity: 100,
  darkness: 25,
  tintStrength: 0,
  tint: '#7c6ee0',
  fit: 'cover',
  position: 'center',
  scale: 100,
  blur: 0,
}

export interface CustomImage {
  url: string
  name: string
}

interface AppearanceContextValue {
  /** the effective appearance (override > server > defaults) */
  appearance: AppearanceSettings
  /** the palette key that's actually active (resolves legacy/localStorage) */
  activeTheme: string
  /** true when the active palette renders dark (toasts, previews) */
  darkMode: boolean
  /** uploaded image on this device, when the account uses one */
  customImage: CustomImage | null
  /** background set to custom-image but no image on this device */
  customImageMissing: boolean
  saving: boolean
  setTheme: (key: string) => void
  setCustomColors: (colors: CustomTheme) => void
  setBackground: (id: string | null) => void
  updateBackgroundSettings: (patch: Record<string, number | string>) => void
  setSurface: (surface: SurfaceTreatment) => void
  uploadCustomImage: (file: File) => void
  removeCustomImage: () => void
  resetTheme: () => void
  resetBackground: () => void
  resetAll: () => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider')
  return ctx
}

/** Inject/refresh the custom palette stylesheet. */
function applyCustomStyle(custom: CustomTheme | null): void {
  let el = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null
  if (!custom) {
    if (el) el.textContent = ''
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = CUSTOM_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = customThemeCss(custom)
}

/** Apply one appearance to the document root (no React state involved). */
export function applyAppearanceToDom(appearance: AppearanceSettings, setTheme: (k: string) => void): void {
  const root = document.documentElement
  setTheme(appearance.theme)
  applyCustomStyle(appearance.theme === 'custom' ? appearance.custom : null)
  const dark =
    appearance.theme === 'custom'
      ? isCustomThemeDark(appearance.custom)
      : (paletteMeta(appearance.theme)?.dark ?? false)
  root.dataset.mode = dark ? 'dark' : 'light'
  if (appearance.surface !== 'solid') root.dataset.surface = appearance.surface
  else delete root.dataset.surface
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings()
  const { data: me } = useMe()
  const { theme: nextTheme, setTheme } = useTheme()
  const saveSettings = useUpdateSettings()

  // local pick wins until the server confirms it (compare by value — the
  // poll refreshes object identities constantly)
  const [override, setOverride] = useState<AppearanceSettings | null>(null)

  const serverAppearance = settings?.appearance ?? null
  const effective: AppearanceSettings = useMemo(() => {
    if (override) return override
    if (serverAppearance) return serverAppearance
    // never saved: honour whatever this device's next-themes has (or default)
    const local = migrateThemeKey(nextTheme)
    return { ...DEFAULT_APPEARANCE, theme: isPaletteKey(local) || local === 'custom' ? local : 'light' }
  }, [override, serverAppearance, nextTheme])

  /** Apply + persist a new appearance. The local pick wins until the save
   *  settles (success → the server state is authoritative again; failure →
   *  revert), so a slow or queued save never flickers the UI. */
  const commit = useCallback(
    (next: AppearanceSettings) => {
      setOverride(next)
      applyAppearanceToDom(next, setTheme)
      // refresh the offline/PWA cache so the next cold boot paints this
      const cached = loadSettingsCache()
      saveSettingsCache({ theme: next.theme, timezone: cached?.timezone ?? null, appearance: next }, me?.id ?? null)
      saveSettings.mutate(
        { appearance: next },
        {
          onSuccess: () => setOverride(null),
          onError: (err) => {
            setOverride(null)
            if (serverAppearance) applyAppearanceToDom(serverAppearance, setTheme)
            else applyAppearanceToDom({ ...DEFAULT_APPEARANCE }, setTheme)
            toast.error('Could not save your appearance', {
              description: `${err.message} — reverted on this device.`,
            })
          },
        },
      )
    },
    [me?.id, saveSettings, setTheme, serverAppearance],
  )

  const setThemeKey = useCallback(
    (key: string) => {
      commit({
        ...effective,
        theme: key,
        // picking a preset clears the custom palette; picking custom keeps
        // whatever custom colours exist (or the default set on first open)
        custom: key === 'custom' ? (effective.custom ?? DEFAULT_CUSTOM) : null,
      })
    },
    [commit, effective],
  )

  const setCustomColors = useCallback((colors: CustomTheme) => commit({ ...effective, theme: 'custom', custom: colors }), [commit, effective])

  const setBackground = useCallback(
    (id: string | null) => {
      const background = id
        ? id === 'custom-image'
          ? // the upload isn't part of the catalog — build its default config
            { id: 'custom-image', settings: DEFAULT_CUSTOM_IMAGE_SETTINGS }
          : defaultBackgroundConfig(id)
        : null
      commit({ ...effective, background })
    },
    [commit, effective],
  )

  const updateBackgroundSettings = useCallback(
    (patch: Record<string, number | string>) => {
      const current = effective.background ?? { id: 'none', settings: {} }
      if (current.id === 'none' && !('id' in patch)) return
      commit({
        ...effective,
        background: { id: current.id, settings: { ...current.settings, ...patch } },
      })
    },
    [commit, effective],
  )

  const setSurface = useCallback((surface: SurfaceTreatment) => commit({ ...effective, surface }), [commit, effective])

  const resetTheme = useCallback(() => commit({ ...effective, theme: DEFAULT_APPEARANCE.theme, custom: null }), [commit, effective])
  const resetBackground = useCallback(() => commit({ ...effective, background: null }), [commit, effective])
  const resetAll = useCallback(() => {
    commit({ ...DEFAULT_APPEARANCE })
    toast.success('Appearance reset to defaults')
  }, [commit])

  // -------------------------------------------------------------------------
  // apply the effective appearance whenever it changes (boot + cross-device
  // sync from the settings poll + override clearing)
  // -------------------------------------------------------------------------
  const lastApplied = useRef<string>('')
  useEffect(() => {
    const key = JSON.stringify(effective)
    if (key === lastApplied.current) return
    lastApplied.current = key
    applyAppearanceToDom(effective, setTheme)
    // keep the offline cache warm even when the change came from the server
    const cached = loadSettingsCache()
    saveSettingsCache({ theme: effective.theme, timezone: cached?.timezone ?? null, appearance: effective }, me?.id ?? null)
  }, [effective, setTheme, me?.id])

  // -------------------------------------------------------------------------
  // custom image (IndexedDB, this device, per account)
  // -------------------------------------------------------------------------
  const [customImage, setCustomImage] = useState<CustomImage | null>(null)
  const [imageMissing, setImageMissing] = useState(false)
  const userId = me?.id ?? null
  const wantsImage = effective.background?.id === 'custom-image'

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    // all state updates flow through the promise chain (never synchronous
    // inside the effect body)
    void (async () => {
      if (!wantsImage || !userId) {
        return { image: null as CustomImage | null, missing: !wantsImage ? false : true }
      }
      const stored = await loadImage(userId)
      if (stored) {
        url = URL.createObjectURL(stored.blob)
        return { image: { url, name: stored.name } as CustomImage, missing: false }
      }
      return { image: null as CustomImage | null, missing: true } // chosen on another device
    })().then((res) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url)
        return
      }
      setCustomImage(res.image)
      setImageMissing(res.missing)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [wantsImage, userId])

  const uploadCustomImage = useCallback(
    (file: File) => {
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
        toast.error('Unsupported image', { description: 'PNG, JPG or WebP please.' })
        return
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error('Image too large', { description: 'Please pick one under 8 MB.' })
        return
      }
      const finish = (url: string) => {
        setCustomImage((old) => {
          if (old?.url) URL.revokeObjectURL(old.url)
          return { url, name: file.name }
        })
        setImageMissing(false)
        const current = effective.background?.id === 'custom-image' ? effective.background : { id: 'custom-image', settings: { ...DEFAULT_CUSTOM_IMAGE_SETTINGS } }
        commit({ ...effective, background: current })
        toast.success('Background image saved', {
          description: 'It stays on this device — not synced to your account.',
        })
      }
      if (!userId) {
        finish(URL.createObjectURL(file))
        return
      }
      saveImage(userId, file, file.name)
        .then(() => finish(URL.createObjectURL(file)))
        .catch(() => toast.error('Could not save the image', { description: 'This browser blocked local storage for it.' }))
    },
    [commit, effective, userId],
  )

  const removeCustomImage = useCallback(() => {
    setCustomImage((old) => {
      if (old?.url) URL.revokeObjectURL(old.url)
      return null
    })
    setImageMissing(false)
    if (userId) void deleteImage(userId)
    commit({ ...effective, background: null })
  }, [commit, effective, userId])

  const activeTheme = effective.theme
  const darkMode =
    activeTheme === 'custom' ? isCustomThemeDark(effective.custom) : (paletteMeta(activeTheme)?.dark ?? false)

  const value: AppearanceContextValue = {
    appearance: effective,
    activeTheme,
    darkMode,
    customImage,
    customImageMissing: wantsImage && imageMissing,
    saving: saveSettings.isPending,
    setTheme: setThemeKey,
    setCustomColors,
    setBackground,
    updateBackgroundSettings,
    setSurface,
    uploadCustomImage,
    removeCustomImage,
    resetTheme,
    resetBackground,
    resetAll,
  }

  return (
    <AppearanceContext.Provider value={value}>
      <BackgroundLayer config={effective.background} customImageUrl={customImage?.url ?? null} />
      {children}
    </AppearanceContext.Provider>
  )
}

/** A sensible starting custom palette (a neutral dark theme). */
export const DEFAULT_CUSTOM: CustomTheme = {
  background: '#17171c',
  surface: '#212129',
  surfaceAlt: '#2a2a33',
  border: '#34343f',
  text: '#ececf1',
  textMuted: '#9b9ba6',
  primary: '#8b7cf6',
  accent2: '#38bdf8',
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
}
