import { cn } from "@/lib/utils";
import Link from "next/link";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary: "bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)]",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
  outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 bg-white",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
  /** The affirmative counterpart to danger. Approving leave was drawn with
   * hand-rolled green classes at the one call site that needed it; a variant
   * means it carries the same height, radius, focus ring and disabled state as
   * every other button instead of only the colour being right. */
  success: "bg-green-600 text-white hover:bg-green-700",
};

/** How a disabled button looks, for every variant.
 *
 * It used to be per-variant, and only two of the five had any: primary faded and
 * danger went pale, while secondary, outline and ghost looked exactly as they do
 * when they work. On the Time In / Out card that meant somebody who had already
 * timed out saw a Time Out button indistinguishable from a live one, pressed it,
 * and got nothing — the button was disabled, it just never said so.
 *
 * pointer-events-none is what kills the hover colour change as well; without it
 * a disabled button still lights up under the cursor, which is the strongest
 * "press me" signal there is. The cursor is set on a wrapper instead, since an
 * element with no pointer events cannot show a cursor of its own. */
const DISABLED = "disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none";

const sizeClasses: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-control",
  md: "px-4 py-2 text-control",
  lg: "px-5 py-2.5 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
          variantClasses[variant],
          sizeClasses[size],
          DISABLED,
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </Link>
  );
}
