import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const baseClasses =
  "w-full rounded-lg border border-border bg-zinc-950/80 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/50 focus:bg-zinc-950 focus:ring-2 focus:ring-indigo-500/20";

export default function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${baseClasses} ${className}`} {...props} />;
}

export function FileInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`${baseClasses} file:mr-3 file:rounded-md file:border-0 file:bg-indigo-500/20 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-300 hover:file:bg-indigo-500/30 ${className}`}
      {...props}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${baseClasses} resize-y ${className}`} {...props} />;
}

export const fieldClasses = baseClasses;
