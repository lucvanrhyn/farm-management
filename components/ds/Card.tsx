import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface card. Token-driven (var(--ft-surface/border/r-lg/shadow-sm)).
 *
 *  - `interactive` adds the landed "spotlight glow" hover (accent wash that
 *    follows the cursor — position fed by <FxRuntime>).
 *  - `lift` adds a translateY hover instead (use when glow would fight content).
 */
export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  lift?: boolean;
  as?: React.ElementType;
};

export function Card({ interactive, lift, as, className, ...rest }: CardProps) {
  const Comp = (as ?? "div") as React.ElementType;
  return (
    <Comp
      className={cn(
        "ft-card",
        interactive && "ft-card-interactive",
        lift && "ft-card-lift",
        className,
      )}
      {...rest}
    />
  );
}
