'use client'

import { NotebookPen } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { RoutineData } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A routine title as it appears in a checklist or routine list.
 *
 * When the routine has "How to do it well" notes, the title becomes a
 * tap target that shows them in a small popover — so remembering what a
 * session actually involves never requires digging through the skill
 * tree into the routine's edit dialog. Without notes it renders as
 * plain text (there is nothing to show).
 *
 * `done` only suppresses the dotted-underline affordance on struck-through
 * titles (underline and line-through share the text-decoration property, so
 * applying both at once is unpredictable) — the title stays tappable.
 */
export function RoutineTitle({
  routine,
  className,
  done,
}: {
  routine: Pick<RoutineData, 'id' | 'title' | 'notes'>
  className?: string
  done?: boolean
}) {
  if (!routine.notes) {
    return (
      <span className={cn('inline-block max-w-full', className)}>{routine.title}</span>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-block max-w-full text-left',
            !done &&
              'underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-primary focus-visible:decoration-primary',
            className,
          )}
          aria-label={`How to do it well — ${routine.title}`}
        >
          {routine.title}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-72 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <NotebookPen className="h-3.5 w-3.5 shrink-0 text-primary" />
          How to do it well
        </div>
        <p className="mt-1.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
          {routine.notes}
        </p>
      </PopoverContent>
    </Popover>
  )
}
