import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Momentum · Goal & Plan Tracker",
  description:
    "Set measurable goals with deadlines, break skills into step-by-step plans, and see exactly what you need to do each week to stay on track.",
  keywords: ["goals", "habits", "tracking", "planning", "progress"],
  // installable PWA: boots offline (service worker + cached shell),
  // lists your synced to-dos from the on-device snapshot
  manifest: "/manifest.webmanifest",
  applicationName: "Momentum",
  appleWebApp: {
    capable: true,
    title: "Momentum",
    statusBarStyle: "default",
  },
  icons: {
    // the Momentum mark: M as an ascending progress line (see public/favicon.svg)
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
} as const;

/**
 * Pre-paint appearance restore: reads the offline settings cache (kept fresh
 * by AppearanceProvider) and, for custom palettes, injects the CSS variables
 * before first paint — mirroring customThemeCss in
 * src/lib/appearance/palettes.ts. Surface treatment + dark-mode flag ride
 * along. Runs before next-themes hydration so a custom dark palette never
 * flashes light.
 */
const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var raw=localStorage.getItem('momentum:settings-cache');if(!raw)return;
var c=JSON.parse(raw);var a=c&&c.settings&&c.settings.appearance;if(!a)return;
function lum(h){var n=parseInt(h.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255;function f(x){return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)}return .2126*f(r)+.7152*f(g)+.0722*f(b)}
function ct(h){return lum(h)>.35?'#141414':'#fbfbfb'}
var t=a.theme;
if(t==='custom'&&a.custom){var v=a.custom,dk=lum(v.background)<.3;
var css='html[data-theme="custom"]{color-scheme:'+(dk?'dark':'light')+';--background:'+v.background+';--foreground:'+v.text+';--card-solid:'+v.surface+';--card-foreground:'+v.text+';--popover-solid:'+v.surface+';--popover-foreground:'+v.text+';--primary:'+v.primary+';--primary-foreground:'+ct(v.primary)+';--secondary:'+v.surfaceAlt+';--secondary-foreground:'+v.text+';--muted:'+v.surfaceAlt+';--muted-foreground:'+v.textMuted+';--accent:color-mix(in oklab,'+v.accent2+' 14%,'+v.surface+');--accent-foreground:'+v.text+';--destructive:'+v.error+';--destructive-foreground:'+ct(v.error)+';--success:'+v.success+';--success-foreground:'+ct(v.success)+';--warning:'+v.warning+';--warning-foreground:'+ct(v.warning)+';--border:'+v.border+';--input:'+v.border+';--ring:'+v.primary+';--chart-1:'+v.primary+';--chart-2:'+v.accent2+';--chart-3:'+v.warning+';--chart-4:'+v.success+';--chart-5:color-mix(in oklab,'+v.accent2+' 60%,'+v.primary+');--sidebar:'+v.surface+';--sidebar-foreground:'+v.text+';--sidebar-primary:'+v.primary+';--sidebar-primary-foreground:'+ct(v.primary)+';--sidebar-accent:color-mix(in oklab,'+v.accent2+' 14%,'+v.surface+');--sidebar-accent-foreground:'+v.text+';--sidebar-border:'+v.border+';--sidebar-ring:'+v.primary+'}';
var s=document.createElement('style');s.id='momentum-custom-theme';s.textContent=css;document.head.appendChild(s);
document.documentElement.dataset.mode=dk?'dark':'light';
}else{var d=['dark','forest','sunset','petrolhead','ultraviolet','pomegranate','cryosphere','marigold','nightshade','oxidation','afterburn','mycelium'].indexOf(t)>=0;
document.documentElement.dataset.mode=d?'dark':'light';}
if(a.surface&&a.surface!=='solid')document.documentElement.dataset.surface=a.surface;
}catch(e){}})();`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
