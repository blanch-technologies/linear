"use client";

import { useTheme } from "next-themes";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-shell";

const themes = [
  { value: "system", label: "System", description: "Match your device." },
  { value: "light", label: "Light", description: "" },
  { value: "dark", label: "Dark", description: "" },
];

export default function PreferencesPage() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsPage title="Preferences" description="Personal settings for this browser.">
      <SettingsSection title="Interface theme">
        <RadioGroup value={theme ?? "dark"} onValueChange={setTheme} className="gap-0 divide-y divide-border">
          {themes.map((option) => (
            <Label key={option.value} htmlFor={`theme-${option.value}`} className="flex cursor-pointer items-center gap-3 px-4 py-3 font-normal">
              <RadioGroupItem id={`theme-${option.value}`} value={option.value} />
              <span className="flex-1">{option.label}</span>
              {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
            </Label>
          ))}
        </RadioGroup>
      </SettingsSection>
    </SettingsPage>
  );
}
