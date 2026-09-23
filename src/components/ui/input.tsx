import * as React from 'react';
import { cn } from '../../lib/cn';

export const inputClasses =
  'flex h-10 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-sm shadow-black/30 transition-colors placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input type={type} className={cn(inputClasses, className)} ref={ref} {...props} />
));
Input.displayName = 'Input';

export { Input };
