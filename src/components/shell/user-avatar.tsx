import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/** A person's picture, or their initials in full-contrast text. */
export function UserAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback className="bg-surface-3 text-[10px] font-medium text-foreground">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
