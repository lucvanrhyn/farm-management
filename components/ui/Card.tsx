import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export default function Card({ title, className = "", children, ...props }: CardProps) {
  return (
    <div className={`bg-white rounded-2xl border border-stone-200 shadow-sm p-4 ${className}`} {...props}>
      {title && <h2 className="text-base font-semibold text-stone-700 mb-3">{title}</h2>}
      {children}
    </div>
  );
}
