'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Small curated emoji grid used by the checkpoint / path editors (and any
 * other inline icon pick). `value` is a single emoji character; picking one
 * applies it and closes the grid. Anything typed or pasted into the input
 * works too — any emoji is allowed, the grid is just quick picks.
 */

export const SKILL_EMOJI_CHOICES = [
  '✨', '⭐', '🌟', '💫', '🔥', '⚡', '🎯', '🏁',
  '🌱', '🌿', '🍀', '🌳', '📘', '📚', '🧠', '💡',
  '🎵', '🎼', '🎸', '🎹', '🏀', '⚽', '🎾', '🏐',
  '🏃', '💪', '🧘', '🥗', '🏆', '🥇', '💎', '🛡️',
]

/** Keep the first grapheme-ish chunk of free-typed input: no spaces, ≤8 chars. */
function sanitizeEmoji(raw: string): string {
  return raw.replace(/\s+/g, '').slice(0, 8)
}

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
  const [custom, setCustom] = useState('')

  function applyCustom() {
    const e = sanitizeEmoji(custom)
    if (e) {
      onChange(e)
      setOpen(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setCustom('')
      }}
    >
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
        {/* any emoji — typed or pasted */}
        <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(sanitizeEmoji(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyCustom()
              }
            }}
            placeholder="Or type any emoji…"
            className="h-7 flex-1 text-xs"
            maxLength={8}
            autoComplete="off"
            aria-label="Type a custom emoji"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Use this emoji"
            disabled={!custom.trim()}
            onClick={applyCustom}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
