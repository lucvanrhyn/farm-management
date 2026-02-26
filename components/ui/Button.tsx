import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

export default function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  const base = "px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-green-700 text-white hover:bg-green-800",
    secondary: "bg-stone-100 text-stone-700 hover:bg-stone-200",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
