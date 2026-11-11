"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"
import { useAppearance } from "@/components/app/appearance/AppearanceProvider"

const Toaster = ({ ...props }: ToasterProps) => {
  // toast styling follows the effective appearance — including custom
  // palettes, whose light/dark-ness is decided by their own colours
  const { darkMode } = useAppearance()

  return (
    <Sonner
      theme={darkMode ? "dark" : "light"}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
