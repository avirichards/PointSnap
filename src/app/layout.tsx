import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import "./product.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PointSnap — Award intelligence",
    template: "%s · PointSnap",
  },
  description:
    "Search live award-flight availability from connected airlines. Compare points, taxes and cabin options in one workspace.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PointSnap",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ed" },
    { media: "(prefers-color-scheme: dark)", color: "#191918" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeCookie = (await cookies()).get("theme")?.value;
  const appearance =
    themeCookie === "light" || themeCookie === "dark" ? themeCookie : "system";
  const isDark = appearance === "dark";

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full ${
        isDark ? "dark" : ""
      }`}
      data-appearance={appearance}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=document.documentElement.dataset.appearance;document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));})();`,
          }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[100] focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-primary-foreground focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
