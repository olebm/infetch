import { forwardRef, useId } from "react";

type FormFieldProps = {
  label: React.ReactNode;
  /** Optional node shown right-aligned in the label row (e.g. a ConfidenceDot) */
  hint?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string }) => React.ReactNode;
};

export function FormField({ label, hint, helperText, error, required, children }: FormFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-xs font-medium text-muted">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {hint && <span>{hint}</span>}
      </div>
      {children({ id, "aria-describedby": helperText || error ? helpId : undefined })}
      {(helperText || error) && (
        <div id={helpId} className={`text-xs ${error ? "text-danger" : "text-muted"}`}>
          {error ?? helperText}
        </div>
      )}
    </div>
  );
}

const INPUT_BASE =
  "w-full rounded border border-line bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-muted/10 disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${INPUT_BASE} ${className}`} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return <select ref={ref} className={`${INPUT_BASE} ${className}`} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={`${INPUT_BASE} ${className}`} {...props} />;
});
