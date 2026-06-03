import { cn } from "@/lib/utils";

type DisabledActionButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
};

export function DisabledActionButton({
  children,
  variant = "secondary",
  className,
}: DisabledActionButtonProps) {
  return (
    <button
      type="button"
      disabled
      title="Diese Aktion wird im nächsten Implementierungs-Slice angebunden."
      className={cn(
        "inline-flex cursor-not-allowed items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium opacity-60",
        variant === "primary"
          ? "bg-brand text-white shadow-soft"
          : "border border-line bg-white text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
