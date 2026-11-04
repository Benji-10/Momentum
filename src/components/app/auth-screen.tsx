'use client'

import { useState } from 'react'
import {
  CalendarCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  MailCheck,
  Sparkles,
  TriangleAlert,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLogin, useRecoverPassword, useSignup } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type Mode = 'signup' | 'signin' | 'forgot'

/**
 * The sign-in / create-account gate — a fully custom UI for Netlify
 * Identity (no default identity widget). Your goals live in your account,
 * so they follow you to any device.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPw, setShowPw] = useState(false)

  // forgot-password flow state
  const [sent, setSent] = useState(false)
  const [devCode, setDevCode] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const login = useLogin()
  const signup = useSignup()
  const recover = useRecoverPassword()
  const pending = login.isPending || signup.isPending || recover.isPending
  const error = (login.error ?? signup.error ?? recover.error)?.message ?? null

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const valid =
    validEmail &&
    (mode === 'forgot'
      ? sent
        ? codeInput.trim().length > 0 && newPassword.length >= 8
        : true
      : password.length >= 8 && (mode === 'signin' || name.trim().length <= 80))

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!valid || pending) return
    if (mode === 'signin') {
      login.mutate({ email, password })
    } else if (mode === 'signup') {
      signup.mutate({ email, password, name: name.trim() || undefined })
    } else if (!sent) {
      recover.mutate(
        { email },
        {
          onSuccess: (res) => {
            if ('reset' in res) {
              toast.success('Password updated — you are signed in')
              window.location.reload()
            } else if (res.devCode) {
              setDevCode(res.devCode)
              setSent(true)
            } else {
              setSent(true)
            }
          },
        },
      )
    } else {
      recover.mutate(
        { email, code: codeInput.trim(), newPassword },
        {
          onSuccess: () => {
            toast.success('Password updated — you are signed in')
            window.location.reload()
          },
        },
      )
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <CalendarCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === 'signup' ? 'Your goals, on every device' : mode === 'signin' ? 'Welcome back' : 'Reset your password'}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
            {mode === 'signup'
              ? 'Create an account and your roadmap, routines and progress sync wherever you sign in.'
              : mode === 'signin'
                ? 'Sign in and pick up right where you left off — on any device.'
                : "We'll send you a way back in — no stress, it happens to everyone."}
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          {/* mode switch */}
          {mode !== 'forgot' && (
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                onClick={() => setMode('signup')}
                className={cn(
                  'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-all min-[400px]:px-3',
                  mode === 'signup' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <UserPlus className="h-4 w-4 shrink-0" /> Create account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                onClick={() => setMode('signin')}
                className={cn(
                  'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-all min-[400px]:px-3',
                  mode === 'signin' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LogIn className="h-4 w-4 shrink-0" /> Sign in
              </button>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-2">
                <Label htmlFor="auth-name">
                  Name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex"
                  maxLength={80}
                  autoComplete="name"
                />
              </div>
            )}

            {!(mode === 'forgot' && sent) && (
              <div className="space-y-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auth-password">Password</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot')
                      setSent(false)
                      setDevCode('')
                      setPassword('')
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="auth-password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={8}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* forgot-password: after sending */}
            {mode === 'forgot' && sent && (
              <>
                {devCode ? (
                  <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
                    <p className="flex items-center gap-1.5 font-medium">
                      <MailCheck className="h-3.5 w-3.5 text-primary" /> Preview mode — recovery code
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      A deployed site emails this code. Here it comes straight back:
                    </p>
                    <code className="mt-1.5 block select-all rounded bg-background px-2 py-1 font-mono text-sm tracking-widest">
                      {devCode}
                    </code>
                  </div>
                ) : (
                  <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <MailCheck className="h-3.5 w-3.5 text-primary" /> Check your inbox
                    </p>
                    <p className="mt-1">
                      The link inside signs you straight back in — then set a fresh password from the account menu.
                    </p>
                  </div>
                )}
                {devCode && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="recover-code">Recovery code</Label>
                      <Input
                        id="recover-code"
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value)}
                        placeholder="Paste the code"
                        className="font-mono tracking-widest"
                        autoComplete="one-time-code"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recover-new">New password</Label>
                      <Input
                        id="recover-new"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        minLength={8}
                        autoComplete="new-password"
                        required
                      />
                    </div>
                  </>
                )}
                {!devCode && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />
                    Recovery link sent. Come back here after clicking it in your email.
                  </div>
                )}
              </>
            )}

            {error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!valid || pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Just a moment…
                </>
              ) : mode === 'signup' ? (
                <>
                  <Sparkles className="h-4 w-4" /> Create my account
                </>
              ) : mode === 'signin' ? (
                <>
                  <LogIn className="h-4 w-4" /> Sign in
                </>
              ) : sent && devCode ? (
                <>
                  <KeyRound className="h-4 w-4" /> Set new password &amp; sign in
                </>
              ) : (
                <>
                  <MailCheck className="h-4 w-4" /> Send recovery link
                </>
              )}
            </Button>

            {mode === 'forgot' && (
              <button
                type="button"
                onClick={() => {
                  setMode('signin')
                  setSent(false)
                  setDevCode('')
                }}
                className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                ← Back to sign in
              </button>
            )}
          </form>

          {mode === 'signup' && (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Anything you&apos;ve already built here gets attached to your new account — nothing is lost.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Shown when a deployment has no identity backend reachable at all. */
export function IdentityUnconfiguredNotice() {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <TriangleAlert className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Accounts aren&apos;t enabled on this site yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          This deployment expects <strong>Netlify Identity</strong>. Enable it in your Netlify site settings
          (Site configuration → Identity → Enable Identity), then reload this page.
        </p>
      </div>
    </div>
  )
}
