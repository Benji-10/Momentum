'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, apiFetch } from '@/lib/api-client'
import {
  completeRecovery,
  currentIdentityUser,
  identityLogin,
  identityLogout,
  identitySignup,
  identityUpdate,
  initIdentity,
  requestRecovery,
} from '@/lib/identity-client'
import { handleUserSwitch, isNetworkError, loadSettingsCache, saveSettingsCache } from '@/lib/offline'
import type { SessionUser } from '@/lib/auth'
import { DEFAULT_SETTINGS, type UserSettings } from '@/lib/settings'
import type { AppearanceSettings } from '@/lib/appearance/types'

/** The shared ['me'] fetch: verifies the identity token with the server on
 *  load, then re-checks on window focus so a sign-out on another device is
 *  picked up when you come back. Also returns the user's synced app settings
 *  (theme + timezone) that every device applies.
 *
 *  When the network is down the local session still identifies the user (and
 *  the cached settings keep theme/timezone alive), so the offline list stays
 *  reachable — the next successful poll re-verifies, and a real 401 signs
 *  out properly. */
async function fetchMe(): Promise<{ user: SessionUser | null; settings: UserSettings }> {
  await initIdentity()
  const identity = await currentIdentityUser()
  if (!identity) return { user: null, settings: { ...DEFAULT_SETTINGS } }
  // confirms the token server-side; also creates the app row (and adopts
  // unclaimed goals) on the very first sign-in
  try {
    const res = await apiFetch<{ user: SessionUser | null; settings: UserSettings }>('/api/auth/me')
    saveSettingsCache(res.settings, res.user?.id ?? identity.id)
    return res
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/no longer exists/i.test(msg)) {
      // the stored session points at an account that has since been deleted —
      // say so, so it isn't mistaken for "login is broken"
      toast.error('Your account no longer exists — please create it again', {
        description: 'The server database was reset, so your previous sign-in can no longer be verified.',
      })
      throw e // a real rejection: show the sign-in gate
    }
    if (e instanceof ApiError ? e.status !== 401 : isNetworkError(e)) {
      // offline, cold server boot, proxy hiccup, 5xx — anything that isn't a
      // genuine "session rejected": stay locally signed in (and keep the
      // cached settings alive) so the offline list stays reachable. The next
      // successful poll re-verifies, and a real 401 signs out properly.
      return {
        user: {
          id: identity.id,
          email: identity.email,
          name: (identity.user_metadata?.name as string | undefined) ?? null,
          settings: null,
        },
        settings: loadSettingsCache() ?? { ...DEFAULT_SETTINGS },
      }
    }
    throw e
  }
}

/** Who is signed in (null = nobody). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    select: (d) => d.user,
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}

/** The signed-in user's synced app settings (theme + timezone). Same cache
 *  as useMe — one fetch, two views. */
export function useSettings() {
  return useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    select: (d) => d.settings,
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => identityLogin(email, password),
    onSuccess: async (user) => {
      handleUserSwitch(user.id)
      qc.setQueryData(['me'], {
        user: { id: user.id, email: user.email, name: (user.user_metadata?.name as string) ?? null, settings: null },
        settings: { ...DEFAULT_SETTINGS },
      })
      await qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
  })
}

export function useSignup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ email, password, name }: { email: string; password: string; name?: string }) =>
      identitySignup(email, password, name),
    onSuccess: async (user) => {
      handleUserSwitch(user.id)
      qc.setQueryData(['me'], {
        user: { id: user.id, email: user.email, name: (user.user_metadata?.name as string) ?? null, settings: null },
        settings: { ...DEFAULT_SETTINGS },
      })
      await qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => identityLogout(),
    onSuccess: () => {
      handleUserSwitch(null)
      qc.setQueryData(['me'], { user: null })
      qc.setQueryData(['goals'], { goals: [] })
    },
  })
}

/** Update display name and/or password (Netlify Identity account settings). */
export function useUpdateIdentityProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name?: string; password?: string }) =>
      identityUpdate({
        ...(input.name != null ? { data: { name: input.name, full_name: input.name } } : {}),
        ...(input.password ? { password: input.password } : {}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/** Forgot-password: send the recovery code/email, then (preview flow) set a
 *  new password with the code. */
export function useRecoverPassword() {
  return useMutation({
    mutationFn: async (input: { email: string; code?: string; newPassword?: string }) => {
      if (input.code && input.newPassword) {
        await completeRecovery(input.code, input.newPassword)
        return { reset: true }
      }
      return requestRecovery(input.email)
    },
  })
}

// ---------------------------------------------------------------------------
// App settings (theme + timezone) — saved to the account, synced to every device
// ---------------------------------------------------------------------------

export interface SettingsPatch {
  theme?: string | null
  timezone?: string | null
  /** full appearance block (theme / background / surface) */
  appearance?: AppearanceSettings | null
}

/** Save a settings change to the signed-in account. On success the ['me']
 *  cache is refreshed so every open tab/device picks it up on its next poll. */
export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      apiFetch<{ settings: UserSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['me'], (old: { user: SessionUser | null; settings: UserSettings } | undefined) =>
        old ? { ...old, settings: data.settings } : old,
      )
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}
