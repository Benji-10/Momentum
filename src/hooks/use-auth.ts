'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
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
import type { SessionUser } from '@/lib/auth'

/** Who is signed in (null = nobody). Verifies the identity token with the
 *  server on load, then re-checks on window focus so a sign-out on another
 *  device is picked up when you come back. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<{ user: SessionUser | null }> => {
      await initIdentity()
      const identity = await currentIdentityUser()
      if (!identity) return { user: null }
      // confirms the token server-side; also creates the app row (and adopts
      // unclaimed goals) on the very first sign-in
      return apiFetch<{ user: SessionUser | null }>('/api/auth/me')
    },
    select: (d) => d.user,
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
      qc.setQueryData(['me'], { user: { id: user.id, email: user.email, name: (user.user_metadata?.name as string) ?? null } })
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
      qc.setQueryData(['me'], { user: { id: user.id, email: user.email, name: (user.user_metadata?.name as string) ?? null } })
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
