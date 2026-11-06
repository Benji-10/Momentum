'use client'

import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Small curated emoji grid used by the checkpoint / path editors (and any
 * other inline icon pick). `value` is a single emoji character; picking one
 * applies it and closes the grid.
 */

export const SKILL_EMOJI_CHOICES = [
  '✨', '⭐', '🌟', '💫', '🔥', '⚡', '🎯', '🏁',
  '🌱', '🌿', '🍀', '🌳', '📘', '📚', '🧠', '💡',
  '🎵', '🎼', '🎸', '🎹', '🏀', '⚽', '🎾', '🏐',
  '🏃', '💪', '🧘', '🥗', '🏆', '🥇', '💎', '🛡️',
]

export function EmojiPicker({
  value,
  onChange,
  ariaLabel = 'Pick an icon',
  align = 'start',
}: {
  value: string
  onChange: (emoji: string) => void
  ariaLabel?: string
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title="Change icon"
          className="flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border text-lg transition-colors hover:border-primary/50 hover:bg-accent"
        >
          {value || '✨'}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-56 p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {SKILL_EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`Icon ${e}`}
              onClick={() => {
                onChange(e)
                setOpen(false)
              }}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded text-base leading-none transition-colors hover:bg-accent',
                e === value && 'bg-primary/15 ring-1 ring-primary/50',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
