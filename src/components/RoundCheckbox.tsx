import { Check, Minus } from "lucide-react";

interface Props {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
  title?: string;
}

export function RoundCheckbox({ checked, indeterminate, disabled, onChange, title, ...rest }: Props) {
  const active = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={rest["aria-label"]}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={[
        "inline-flex items-center justify-center h-4 w-4 rounded-full border transition shrink-0",
        active
          ? "bg-primary border-primary text-primary-foreground"
          : "bg-background border-border hover:border-foreground/50",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}
