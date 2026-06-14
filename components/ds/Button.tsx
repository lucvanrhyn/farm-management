import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Design-system button. Variants map to the design's .ft-btn classes.
 *   primary → rust fill + diagonal sheen sweep on hover
 *   default → surface + hairline
 *   ghost   → transparent
 * `icon` is rendered before children.
 */
export type ButtonVariant = "primary" | "default" | "ghost";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: React.ReactNode;
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "ft-btn ft-btn-primary",
  default: "ft-btn",
  ghost: "ft-btn ft-btn-ghost",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(VARIANT_CLASS[variant], className)} {...rest}>
      {icon}
      {children != null && <span>{children}</span>}
    </button>
  );
});
