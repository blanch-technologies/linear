import { TeamSettingsLayout } from "@/components/teams/team-settings";

export default function TeamLayout({ children }: LayoutProps<"/[workspace]/settings/teams/[teamKey]">) {
  return <TeamSettingsLayout>{children}</TeamSettingsLayout>;
}
