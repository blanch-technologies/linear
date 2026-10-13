import { AppShell } from "@/components/shell/app-shell";

export default function MainLayout({ children }: LayoutProps<"/[workspace]">) {
  return <AppShell>{children}</AppShell>;
}
