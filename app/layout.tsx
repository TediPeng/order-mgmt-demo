import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getThemeCookie } from "@/lib/auth";
import { APP_FULL_NAME } from "@/lib/version";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// The favicon is app/icon.png, by file convention -- no `icons` entry here.
// It used to point at /brand-logo.png, which is the 900x637 image the sidebar
// and the login page draw: 140 KB to render at sixteen pixels in a tab. icon.png
// is that same logo at 64x64 and 4.5 KB.
export const metadata: Metadata = {
  title: APP_FULL_NAME,
  description: "Retention order management and agent performance monitoring for 4S ROMA",
};

// "system" can only be resolved in the browser, so it is applied by this
// snippet before first paint rather than after hydration — otherwise the page
// would flash the wrong theme. Light and dark are already decided server-side.
const SYSTEM_THEME_SCRIPT = `try{if(document.documentElement.dataset.theme==='system'){
if(window.matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark');
}}catch(e){}`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await getThemeCookie();

  return (
    <html lang="en" data-theme={theme} className={theme === "dark" ? "dark" : undefined}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
