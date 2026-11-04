'use client'

import { useState } from 'react'
import { KeyRound, Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useUpdateIdentityProfile } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Account settings for the Netlify Identity account behind the custom UX:
 * display name and password. (Email lives in your Netlify Identity account
 * settings on the deployed site.)
 */
export function AccountSettingsDialog({
  open,
  onOpenChange,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string | null
}) {
  const [newName, setNewName] = useState(name ?? '')
  const [password, setPassword] = useState('')
  const update = useUpdateIdentityProfile()

  function save(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = newName.trim()
    if (update.isPending) return
    if (!trimmed && !password) {
      toast('Nothing to update')
      return
    }
    if (password && password.length < 8) {
      toast.error('New password needs at least 8 characters')
      return
    }
    update.mutate(
      {
        ...(trimmed ? { name: trimmed } : {}),
        ...(password ? { password } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Account updated')
          setPassword('')
          onOpenChange(false)
        },
        onError: (err) => toast.error('Could not update account', { description: err.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Your Netlify Identity account — used to sync your goals.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="acct-name">Display name</Label>
            <Input
              id="acct-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Alex"
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acct-password">
              New password <span className="text-muted-foreground">(leave blank to keep)</span>
            </Label>
            <Input
              id="acct-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : password ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <UserRound className="h-4 w-4" />
              )}
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
