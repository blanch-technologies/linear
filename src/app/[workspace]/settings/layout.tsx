import { SettingsShell } from "@/components/settings/settings-shell";

export default function SettingsLayout({ children }: LayoutProps<"/[workspace]/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
