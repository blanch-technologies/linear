import { cn } from "@/lib/utils";

export function WorkspaceLogo({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-linear-135 from-[#8e7cf8] to-[#5544cc] font-bold text-white",
        size === "md" ? "size-[21px] text-xs" : "size-4 text-[9px]",
      )}
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
