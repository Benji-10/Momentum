"use client"

import { Toaster as Sonner, ToasterProps } from "sonner"
import { useAppearance } from "@/components/app/appearance/AppearanceProvider"

/**
 * The toast close button's icon, sized to FILL its 20px circular button.
 *
 * sonner's toast root handles pointerdown with
 * `event.target.setPointerCapture(...)` (for swipe-to-dismiss). When the
 * tap lands on the close button, that capture swallows the subsequent
 * click on WebKit/touch — the X visibly taps but the toast never
 * dismisses. Stopping pointerdown propagation at the icon (which covers
 * the whole button) keeps the swipe machinery out of the tap, so the
 * button's own onClick fires and the toast closes. The same X shape as
 * sonner's default icon, just drawn at the button's full size.
 */
const CloseIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    onPointerDown={(e) => e.stopPropagation()}
    style={{ width: "100%", height: "100%", display: "block" }}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const Toaster = ({ ...props }: ToasterProps) => {
  // toast styling follows the effective appearance — including custom
  // palettes, whose light/dark-ness is decided by their own colours
  const { darkMode } = useAppearance()

  return (
    <Sonner
      theme={darkMode ? "dark" : "light"}
      className="toaster group"
      icons={{ close: CloseIcon }}
      style={
        {
          // Radix modals (goal sheet, dialogs) set pointer-events:none on
          // <body> while open — without this, the toaster inherits it and
          // every toast becomes click-through: visible, but the X (and any
          // action buttons) can never be tapped. The toaster itself stays
          // layout-neutral (its box is empty; toasts are fixed children).
          pointerEvents: "auto",
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
