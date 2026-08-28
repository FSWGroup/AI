import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { getSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: {
      default: settings.brand.appName,
      template: `%s · ${settings.brand.appName}`,
    },
    description: `Training, SOPs, onboarding, and knowledge for ${settings.brand.companyName}.`,
    robots: { index: false, follow: false },
    applicationName: settings.brand.appName,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17365c",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();

  // Brand colors resolved from admin settings override the design-token defaults.
  const brandOverrides = `:root{--brand-primary:${settings.brand.primaryColor};--brand-secondary:${settings.brand.secondaryColor};--brand-accent:${settings.brand.accentColor};--surface-nav:${settings.brand.primaryColor};}`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandOverrides }} />
      </head>
      <body>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--surface-card)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            },
          }}
        />
      </body>
    </html>
  );
}
