// ---------------------------------------------------------------------------
// Reference resolution for imports: dependency refs ("HSK3", "Vocabulary ›
// HSK3") and routine focus refs are written by humans as titles — resolve
// them to node ids at import time, dropping anything ambiguous or cyclic.
// ---------------------------------------------------------------------------

export interface NodeRefEntry {
  id: string
  title: string
  pathTitle: string
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

const SEPARATORS = ['›', '>', '/', ':', '|', ' — ', ' – ']

/**
 * Resolve one human-written node reference to a node id.
 * Accepts a bare title ("HSK3") or a qualified one ("Vocabulary › HSK3").
 * Bare titles prefer a match in the same path, then a unique global match.
 */
export function resolveNodeRef(
  ref: string,
  currentPathTitle: string | null,
  entries: NodeRefEntry[],
): string | null {
  const raw = ref.trim()
  if (!raw) return null
  let pathPart: string | null = null
  let nodePart = raw
  for (const sep of SEPARATORS) {
    const i = raw.indexOf(sep)
    if (i > 0 && i < raw.length - sep.length) {
      pathPart = raw.slice(0, i).trim()
      nodePart = raw.slice(i + sep.length).trim()
      break
    }
  }

  const matchesPath = (e: NodeRefEntry) => pathPart === null || norm(e.pathTitle) === norm(pathPart)
  const matchesNode = (e: NodeRefEntry) => norm(e.title) === norm(nodePart)

  if (pathPart !== null) {
    const both = entries.find((e) => matchesPath(e) && matchesNode(e))
    return both?.id ?? null
  }

  const samePath = currentPathTitle ? entries.filter((e) => norm(e.pathTitle) === norm(currentPathTitle) && matchesNode(e)) : []
  if (samePath.length === 1) return samePath[0].id
  const global = entries.filter((e) => matchesNode(e))
  if (global.length >= 1) return global[0].id
  return null
}

export interface RefPathInput {
  title: string
  nodes: { id: string; title: string; requires: string[] }[]
}

/**
 * Resolve every node's `requires` refs within one goal and return
 * nodeId → dep-id list. Self-references, unknown refs and edges that would
 * create a cycle are quietly dropped so a bad import can never deadlock the
 * tree.
 */
export function buildRequiresIds(paths: RefPathInput[]): Map<string, string[]> {
  const entries: NodeRefEntry[] = paths.flatMap((p) =>
    p.nodes.map((n) => ({ id: n.id, title: n.title, pathTitle: p.title })),
  )
  const pathOf = new Map(entries.map((e) => [e.id, e.pathTitle]))

  // candidate edges: "to" depends on "from"
  const edges: { from: string; to: string }[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    for (const n of p.nodes) {
      for (const ref of n.requires) {
        const from = resolveNodeRef(ref, p.title, entries)
        if (!from || from === n.id) continue
        const key = `${from}->${n.id}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ from, to: n.id })
      }
    }
  }

  // cycle check: add edges one by one; an edge is rejected if its "from" is
  // already reachable from its "to" (it would close a loop)
  const deps = new Map<string, string[]>() // node -> nodes it depends on
  const accepted: { from: string; to: string }[] = []
  for (const e of edges) {
    if (reachable(deps, e.to, e.from)) continue // would create a cycle
    accepted.push(e)
    push(deps, e.to, e.from)
  }

  const out = new Map<string, string[]>()
  for (const e of accepted) push(out, e.to, e.from)
  // nodes without deps get an empty list so callers can distinguish
  // "explicitly no deps" from "default ladder" if they ever need to
  for (const p of paths) for (const n of p.nodes) if (!out.has(n.id)) out.set(n.id, [])
  void pathOf
  return out
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** Is `target` reachable from `start` following the dependency map? */
function reachable(deps: Map<string, string[]>, start: string, target: string): boolean {
  const queue = [...(deps.get(start) ?? [])]
  const visited = new Set<string>([start])
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === target) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    queue.push(...(deps.get(cur) ?? []))
  }
  return false
}

/** Drop edges that would create a dependency cycle (order-preserving). */
export function filterCyclicEdges(edges: { from: string; to: string }[]): { from: string; to: string }[] {
  const deps = new Map<string, string[]>()
  const accepted: { from: string; to: string }[] = []
  for (const e of edges) {
    if (reachable(deps, e.to, e.from)) continue // would close a loop
    accepted.push(e)
    push(deps, e.to, e.from)
  }
  return accepted
}

/** csv form for the SkillNode.requiresIds column. */
export function idsCsv(ids: string[]): string | null {
  return ids.length ? ids.join(',') : null
}
