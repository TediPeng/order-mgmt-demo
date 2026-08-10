import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getThemeCookie } from "@/lib/auth";
import { APP_FULL_NAME } from "@/lib/version";
import { SpeedInsights } from "@vercel/speed-insights/next";

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

export const metadata: Metadata = {
  title: APP_FULL_NAME,
  description: "Retention order management and agent performance monitoring for 4S ROMA",
  icons: { icon: "/brand-logo.png" },
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
        <SpeedInsights />
      </body>
    </html>
  );
}
