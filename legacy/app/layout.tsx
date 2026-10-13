import type { Metadata } from "next";
import "./linear.css";

export const metadata: Metadata = {
  title: "Linear Workspace",
  description: "A focused workspace for planning and building products.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
