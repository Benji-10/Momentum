'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, CopyPlus, LayoutDashboard, LogOut, Map as MapIcon, Plus, RefreshCw, Repeat, Settings, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData } from '@/lib/types'
import { useGoals, useSeedDemo } from '@/hooks/use-goals'
import { useLogout, useMe } from '@/hooks/use-auth'
import { initIdentity } from '@/lib/identity-client'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { DashboardTab } from '@/components/app/dashboard-tab'
import { ScheduleTab } from '@/components/app/schedule-tab'
import { RoadmapTab } from '@/components/app/roadmap-tab'
import { ReviewTab } from '@/components/app/review-tab'
import { GoalDetailSheet } from '@/components/app/goal-detail-sheet'
import { CreateGoalDialog } from '@/components/app/create-goal-dialog'
import { BulkCreateDialog } from '@/components/app/bulk-create-dialog'
import { ImportDialog } from '@/components/app/import-dialog'
import { EmptyState } from '@/components/app/empty-state'
import { AuthScreen, IdentityUnconfiguredNotice } from '@/components/app/auth-screen'
import { BrandMark } from '@/components/app/brand-mark'
import { AccountSettingsDialog } from '@/components/app/account-settings'
import { ExportButton, ImportButton, ThemePicker, exportData } from '@/components/app/theme-picker'

/** Manual sync button — shows freshness, taps to pull the latest from the server. */
function SyncButton({ goalsQuery }: { goalsQuery: ReturnType<typeof useGoals> }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.round((Date.now() - goalsQuery.dataUpdatedAt) / 1000))
  const when =
    goalsQuery.isFetching || secs < 5
      ? 'just now'
      : secs < 60
        ? `${secs}s ago`
        : secs < 3600
          ? `${Math.floor(secs / 60)}m ago`
          : `${Math.floor(secs / 3600)}h ago`
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 text-muted-foreground"
      aria-label={`Sync now (last synced ${when})`}
      title={`Synced ${when} — click to refresh`}
      onClick={() => goalsQuery.refetch()}
    >
      <RefreshCw className={cn('h-4 w-4', goalsQuery.isFetching && 'animate-spin')} />
    </Button>
  )
}

function App({ email, name }: { email: string; name: string | null }) {
  const goalsQuery = useGoals()
  const { data: goals, isLoading, isError, error } = goalsQuery
  const seedDemo = useSeedDemo()
  const logout = useLogout()

  const [detail, setDetail] = useState<{ id: string; tab?: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editGoal, setEditGoal] = useState<GoalData | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)

  // find the live version of the selected goal so the sheet updates after mutations
  const detailGoal = goals?.find((g) => g.id === detail?.id) ?? null

  const categories = useMemo(
    () => [...new Set((goals ?? []).map((g) => g.category).filter((x): x is string => !!x))].sort(),
    [goals],
  )

  function openDetail(g: GoalData, tab?: string) {
    setDetail({ id: g.id, tab })
  }

  function openEdit(g: GoalData) {
    setDetail(null)
    setEditGoal(g)
    setCreateOpen(true)
  }

  function openCreate() {
    setEditGoal(null)
    setCreateOpen(true)
  }

  function handleSeed() {
    seedDemo.mutate(undefined, {
      onSuccess: () => toast.success('Demo data loaded — explore the tabs!'),
      onError: (e) => toast.error('Could not load demo data', { description: e.message }),
    })
  }

  const initial = (name || email).trim().charAt(0).toUpperCase() || '·'

  return (
    <div className="flex min-h-screen flex-col">
      {/* header */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-1.5 px-3 min-[420px]:gap-2 sm:gap-3 sm:px-6">
          <BrandMark className="h-9 w-9" />
          <div className="mr-auto min-w-0">
            <div className="hidden truncate text-lg font-bold leading-tight tracking-tight min-[420px]:block">
              Momentum
            </div>
            <div className="hidden truncate text-xs text-muted-foreground lg:block">
              {name ? `${name} · ` : ''}synced to your account
            </div>
          </div>
          <ImportButton onClick={() => setImportOpen(true)} />
          <ExportButton />
          <ThemePicker />
          <SyncButton goalsQuery={goalsQuery} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 gap-1.5 px-1.5"
                aria-label="Account"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {initial}
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-semibold">{name || 'My account'}</div>
                <div className="truncate text-xs text-muted-foreground">{email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={() => setAcctOpen(true)}>
                <Settings className="h-4 w-4" /> Account settings
              </DropdownMenuItem>
              {/* Export lives here on phones — the header buttons are
                  hidden below sm so the bar fits a 320px screen */}
              <DropdownMenuItem className="gap-2 sm:hidden" onClick={() => void exportData()}>
                <Download className="h-4 w-4" /> Export your data
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onClick={() =>
                  logout.mutate(undefined, {
                    onSuccess: () => toast.success('Signed out — see you soon'),
                  })
                }
              >
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex shrink-0">
            <Button onClick={openCreate} className="rounded-r-none" aria-label="Create a new goal">
              <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">New goal</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="More creation options"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={openCreate} className="gap-2">
                  <Plus className="h-4 w-4" /> Single goal
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBulkOpen(true)} className="gap-2">
                  <CopyPlus className="h-4 w-4" /> Bulk add trackers
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportOpen(true)} className="gap-2">
                  <CalendarDays className="h-4 w-4" /> Import roadmap JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-56 rounded-xl" />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-52 rounded-xl" />
              ))}
            </div>
          </div>
        ) : isError ? (
          <div className="mx-auto max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
            <p className="font-semibold text-destructive">Couldn&apos;t load your goals</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            <Button className="mt-4" variant="outline" onClick={() => goalsQuery.refetch()}>
              Try again
            </Button>
          </div>
        ) : (goals?.length ?? 0) === 0 ? (
          <EmptyState
            onNewGoal={openCreate}
            onSeed={handleSeed}
            onImport={() => setImportOpen(true)}
            onBulk={() => setBulkOpen(true)}
            seeding={seedDemo.isPending}
          />
        ) : (
          <Tabs defaultValue="dashboard" className="gap-6">
            <TabsList className="h-11 w-full max-w-xl grid grid-cols-4 rounded-xl p-1">
              <TabsTrigger value="dashboard" className="gap-1.5 rounded-lg px-1 text-xs sm:text-sm" aria-label="Dashboard">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </TabsTrigger>
              <TabsTrigger value="schedule" className="gap-1.5 rounded-lg px-1 text-xs sm:text-sm" aria-label="Schedule">
                <Repeat className="h-4 w-4" />
                <span className="hidden sm:inline">Schedule</span>
              </TabsTrigger>
              <TabsTrigger value="roadmap" className="gap-1.5 rounded-lg px-1 text-xs sm:text-sm" aria-label="Roadmap">
                <MapIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Roadmap</span>
              </TabsTrigger>
              <TabsTrigger value="review" className="gap-1.5 rounded-lg px-1 text-xs sm:text-sm" aria-label="Review">
                <CalendarDays className="h-4 w-4" />
                <span className="hidden sm:inline">Review</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard">
              <DashboardTab goals={goals ?? []} onOpen={openDetail} onNewGoal={openCreate} />
            </TabsContent>
            <TabsContent value="schedule">
              <ScheduleTab goals={goals ?? []} onOpenGoal={openDetail} />
            </TabsContent>
            <TabsContent value="roadmap">
              <RoadmapTab goals={goals ?? []} onOpenGoal={openDetail} onNewGoal={openCreate} />
            </TabsContent>
            <TabsContent value="review">
              <ReviewTab goals={goals ?? []} onOpen={openDetail} />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* footer */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
          <span>Momentum · a little progress, every week</span>
          <span className="hidden sm:inline" aria-hidden>·</span>
          <span className="break-words">signed in as {email} — changes sync across your devices</span>
        </div>
      </footer>

      {/* overlays */}
      <GoalDetailSheet
        goal={detailGoal}
        onOpenChange={(open) => !open && setDetail(null)}
        onEdit={openEdit}
        initialTab={detail?.tab}
      />
      <CreateGoalDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setEditGoal(null)
        }}
        editGoal={editGoal}
        categories={categories}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <BulkCreateDialog open={bulkOpen} onOpenChange={setBulkOpen} categories={categories} />
      <AccountSettingsDialog open={acctOpen} onOpenChange={setAcctOpen} name={name} />
    </div>
  )
}

export default function Home() {
  const meQuery = useMe()
  const me = meQuery.data ?? null
  const [identityMode, setIdentityMode] = useState<'netlify' | 'preview' | 'unconfigured' | null>(null)

  useEffect(() => {
    initIdentity().then((i) => setIdentityMode(i.mode))
  }, [])

  if (meQuery.isLoading || identityMode === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="h-12 w-12" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="h-4 w-4 animate-pulse" /> Checking your account…
          </div>
        </div>
      </div>
    )
  }

  if (identityMode === 'unconfigured') return <IdentityUnconfiguredNotice />

  if (!me) return <AuthScreen />

  return <App email={me.email} name={me.name} />
}
