import { forwardRef } from "react";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "border border-brand bg-brand text-white hover:bg-brand-deep disabled:bg-brand/40 disabled:border-brand/40",
  outline:
    "border border-line bg-white text-ink hover:bg-surface disabled:bg-surface disabled:text-muted",
  ghost:
    "border border-transparent bg-transparent text-ink hover:bg-line/40 disabled:text-muted",
  danger:
    "border border-line bg-white text-danger hover:bg-danger-soft disabled:text-danger/40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", fullWidth = false, className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded font-medium transition disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
});
