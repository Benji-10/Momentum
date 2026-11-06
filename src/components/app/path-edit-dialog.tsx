'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData } from '@/lib/types'
import type { SkillPathView } from '@/lib/skill-tree'
import { useDeletePath, useUpdatePath } from '@/hooks/use-goals'
import { EmojiPicker } from '@/components/app/emoji-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Path editor — rename a branch, change its icon / default unit or its
 * description. (Move left/right and delete stay in the path's ⋯ menu.)
 */
export function PathEditDialog({
  goal,
  pv,
  open,
  onOpenChange,
}: {
  goal: GoalData
  pv: SkillPathView
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const updatePath = useUpdatePath(goal.id)
  const deletePath = useDeletePath(goal.id)
  const p = pv.path

  // NOTE: remounted via `key` when opened, so init-from-props is safe.
  const [icon, setIcon] = useState(p.icon)
  const [title, setTitle] = useState(p.title)
  const [unit, setUnit] = useState(p.unit ?? '')
  const [desc, setDesc] = useState(p.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const valid = title.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setConfirmDelete(false); onOpenChange(o) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-lg leading-none">{icon}</span>
            Edit path
          </DialogTitle>
          <DialogDescription>
            {pv.nodes.length} {pv.nodes.length === 1 ? 'checkpoint' : 'checkpoints'} ·{' '}
            {pv.progressPct}% complete
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <EmojiPicker value={icon} onChange={setIcon} ariaLabel="Path icon" />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Path name, e.g. Vocabulary"
              maxLength={80}
              className="min-w-0 flex-1"
              aria-label="Path name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pe-unit" className="text-xs">
              Default unit <span className="text-muted-foreground">(for its checkpoints)</span>
            </Label>
            <Input id="pe-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. words" maxLength={30} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pe-desc" className="text-xs">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="pe-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={1000} placeholder="What is this branch about?" />
          </div>
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:justify-between">
          {confirmDelete ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 gap-1 text-xs"
              disabled={deletePath.isPending}
              onClick={() =>
                deletePath.mutate(
                  { pathId: p.id },
                  {
                    onSuccess: () => {
                      toast.success(`Path "${p.title}" removed`)
                      onOpenChange(false)
                    },
                    onError: (e) => toast.error('Could not remove path', { description: e.message }),
                  },
                )
              }
            >
              <Trash2 className="h-3.5 w-3.5" /> Really delete?
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              aria-label="Delete path"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!valid || updatePath.isPending}
              onClick={() =>
                updatePath.mutate(
                  {
                    pathId: p.id,
                    patch: {
                      title: title.trim(),
                      icon,
                      unit: unit.trim() || null,
                      description: desc.trim() || null,
                    },
                  },
                  {
                    onSuccess: () => {
                      toast.success('Path updated')
                      onOpenChange(false)
                    },
                    onError: (e) => toast.error('Could not update path', { description: e.message }),
                  },
                )
              }
            >
              {updatePath.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
