import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** The single button style used across workspaces; primary marks the page's main action. */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${className ?? ""}`}
      {...rest}
    />
  );
}
