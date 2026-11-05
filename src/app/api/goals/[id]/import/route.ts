import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { parseGoalScopeImportRaw } from '@/lib/import-format'
import { mergeIntoGoal } from '@/lib/merge-import'
import { serializeGoal } from '@/lib/goal-serialize'

/**
 * POST /api/goals/[id]/import — add steps/skill paths/routines to an
 * existing goal from a scoped JSON: { steps?: [], paths?: [], routines?: [] }.
 *
 * Matching items (by title, case-insensitive) are updated in place — their
 * progress and history are kept; only what's in the file is touched. New
 * items are created. Node "requires" refs and routine "node" refs resolve
 * against every checkpoint in the goal, old or new.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const raw = await req.json()
    const scope = parseGoalScopeImportRaw(raw)
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    const summary = await mergeIntoGoal(id, scope)

    const updated = await ownedGoal(id, auth.user)
    return NextResponse.json(
      {
        goal: updated ? serializeGoal(updated) : null,
        added: {
          steps: summary.stepsCreated,
          paths: summary.pathsCreated,
          routines: summary.routinesCreated,
        },
        summary,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/goals/[id]/import failed', e)
    const message = e instanceof Error ? e.message : 'Failed to import'
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 400 })
  }
}
