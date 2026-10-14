import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, body }: { icon?: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {Icon && <Icon className="mb-1 size-6 text-muted-foreground" aria-hidden />}
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-sm text-muted-foreground">{body}</p>
    </div>
  );
}
