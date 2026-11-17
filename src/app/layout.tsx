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

// NOTE: no themeColor here on purpose. A media-based (prefers-color-scheme)
// theme-color follows the OS, not the app — with a dark custom palette on a
// light-scheme phone the PWA status bar stayed white above a dark app. The
// appearance boot script below now owns the meta and colours it with the
// active theme's real background (custom palettes included), and
// applyAppearanceToDom keeps it in sync at runtime.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
} as const;

/**
 * Pre-paint appearance restore: reads the offline settings cache (kept fresh
 * by AppearanceProvider) and, for custom palettes, injects the CSS variables
 * before first paint — mirroring customThemeCss in
 * src/lib/appearance/palettes.ts. Surface treatment + dark-mode flag ride
 * along. Runs before next-themes hydration so a custom dark palette never
 * flashes light.
 *
 * It also creates/updates the sole <meta name="theme-color"> so the status
 * bar of an installed PWA matches the app's loading paint — the theme's own
 * background for presets (BG map, mirrors PRESET_BACKGROUNDS in palettes.ts —
 * keep in sync), the custom palette's background for custom themes, and the
 * OS colour scheme only as a last-resort fallback.
 */
const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var raw=localStorage.getItem('momentum:settings-cache');
var a=null;
if(raw){try{var c=JSON.parse(raw);a=(c&&c.settings&&c.settings.appearance)||null}catch(e){}}
var t=a?a.theme:null;
var bar=null;
function lum(h){var n=parseInt(h.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255;function f(x){return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)}return .2126*f(r)+.7152*f(g)+.0722*f(b)}
function ct(h){return lum(h)>.35?'#141414':'#fbfbfb'}
// preset page backgrounds, oklch -> hex once (mirrors PRESET_BACKGROUNDS
// in src/lib/appearance/palettes.ts — keep in sync when a palette changes)
var BG={light:'#faf9f7',dark:'#0c0e12',forest:'#08110b',berry:'#fef4f8',sunset:'#150e0a',petrolhead:'#090e0a',ultraviolet:'#100817',pomegranate:'#1a0708',cryosphere:'#071116',marigold:'#0f1006',nightshade:'#140713',oxidation:'#100c09',afterburn:'#0e0a08',mycelium:'#0e091a',paper:'#faf9f7',meadow:'#faf9f7',blossom:'#fef4f8',charcoal:'#0c0e12'};
if(t==='custom'&&a.custom){var v=a.custom,dk=lum(v.background)<.3;
var css='html[data-theme="custom"]{color-scheme:'+(dk?'dark':'light')+';--background:'+v.background+';--foreground:'+v.text+';--card-solid:'+v.surface+';--card-foreground:'+v.text+';--popover-solid:'+v.surface+';--popover-foreground:'+v.text+';--primary:'+v.primary+';--primary-foreground:'+ct(v.primary)+';--secondary:'+v.surfaceAlt+';--secondary-foreground:'+v.text+';--muted:'+v.surfaceAlt+';--muted-foreground:'+v.textMuted+';--accent:color-mix(in oklab,'+v.accent2+' 14%,'+v.surface+');--accent-foreground:'+v.text+';--destructive:'+v.error+';--destructive-foreground:'+ct(v.error)+';--success:'+v.success+';--success-foreground:'+ct(v.success)+';--warning:'+v.warning+';--warning-foreground:'+ct(v.warning)+';--border:'+v.border+';--input:'+v.border+';--ring:'+v.primary+';--chart-1:'+v.primary+';--chart-2:'+v.accent2+';--chart-3:'+v.warning+';--chart-4:'+v.success+';--chart-5:color-mix(in oklab,'+v.accent2+' 60%,'+v.primary+');--sidebar:'+v.surface+';--sidebar-foreground:'+v.text+';--sidebar-primary:'+v.primary+';--sidebar-primary-foreground:'+ct(v.primary)+';--sidebar-accent:color-mix(in oklab,'+v.accent2+' 14%,'+v.surface+');--sidebar-accent-foreground:'+v.text+';--sidebar-border:'+v.border+';--sidebar-ring:'+v.primary+'}';
var s=document.createElement('style');s.id='momentum-custom-theme';s.textContent=css;document.head.appendChild(s);
document.documentElement.dataset.mode=dk?'dark':'light';
if(/^#[0-9a-fA-F]{6}$/.test(v.background))bar=v.background;
}else{
var darkList=['dark','forest','sunset','petrolhead','ultraviolet','pomegranate','cryosphere','marigold','nightshade','oxidation','afterburn','mycelium','charcoal'];
document.documentElement.dataset.mode=t&&darkList.indexOf(t)>=0?'dark':'light';
if(t)bar=BG[t]||null;
}
if(!bar)bar=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'#0c0e12':'#faf9f6';
var m=document.querySelector('meta[name="theme-color"]');
if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m)}
m.setAttribute('content',bar);
if(a&&a.surface&&a.surface!=='solid')document.documentElement.dataset.surface=a.surface;
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
