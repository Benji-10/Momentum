import { db } from '@/lib/db'

export interface MilestoneDef {
  value: number
  label: string | null
}

/** Normalize a raw milestones payload (numbers, {value,label}, or csv string). */
export function normalizeMilestoneDefs(raw: unknown, target: number): MilestoneDef[] {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  const byValue = new Map<number, string | null>()
  for (const item of list) {
    let value: number | null = null
    let label: string | null = null
    if (typeof item === 'number' && Number.isFinite(item)) value = item
    else if (item && typeof item === 'object') {
      const o = item as { value?: unknown; label?: unknown }
      if (typeof o.value === 'number' && Number.isFinite(o.value)) value = o.value
      if (typeof o.label === 'string' && o.label.trim()) label = o.label.trim()
    }
    if (value == null) continue
    if (value <= 0 || value >= target) continue
    if (!byValue.has(value)) byValue.set(value, label)
  }
  return [...byValue.entries()].sort((a, b) => a[0] - b[0]).map(([value, label]) => ({ value, label }))
}

/**
 * Replace a node's milestone definitions. Preserves nothing — the caller
 * should follow up with syncMilestoneReached to stamp reachedAt values.
 */
export async function replaceNodeMilestones(nodeId: string, defs: MilestoneDef[]) {
  await db.skillMilestone.deleteMany({ where: { nodeId } })
  if (defs.length === 0) return
  await db.skillMilestone.createMany({ data: defs.map((m) => ({ nodeId, value: m.value, label: m.label })) })
}

/** Stamp/unstamp reachedAt based on the node's current progress. */
export async function syncMilestoneReached(nodeId: string, currentValue: number) {
  const rows = await db.skillMilestone.findMany({ where: { nodeId } })
  const now = new Date()
  for (const m of rows) {
    const reached = currentValue >= m.value
    if (reached && !m.reachedAt) {
      await db.skillMilestone.update({ where: { id: m.id }, data: { reachedAt: now } })
    } else if (!reached && m.reachedAt) {
      await db.skillMilestone.update({ where: { id: m.id }, data: { reachedAt: null } })
    }
  }
}
