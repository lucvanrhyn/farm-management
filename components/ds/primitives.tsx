import * as React from "react";
import { cn } from "@/lib/utils";

/** Uppercase tracked eyebrow label (section headers). */
export function Label({ className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ft-label", className)} {...rest} />;
}

/** Keycap glyph. */
export function Kbd({ className, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("ft-kbd", className)} {...rest} />;
}

/** Dashed divider line. */
export function DotLine({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ft-dotline", className)} role="separator" {...rest} />;
}
