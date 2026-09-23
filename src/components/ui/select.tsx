import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '../../lib/cn';

function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

const Select = ({ value, onValueChange, options, ariaLabel, disabled, className }: SelectProps) => (
  <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectPrimitive.Trigger
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-10 items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-sm shadow-black/30',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-40 [&>span]:truncate',
        className,
      )}
    >
      <SelectPrimitive.Value />
      <SelectPrimitive.Icon asChild>
        <span className="text-faint">
          <ChevronDownIcon />
        </span>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        className="z-50 max-h-72 min-w-[10rem] overflow-hidden rounded-md border border-border bg-raised p-1 shadow-xl shadow-black/50"
      >
        <SelectPrimitive.Viewport className="p-1">
          {options.map((opt) => (
            <SelectPrimitive.Item
              key={opt.value}
              value={opt.value}
              className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent-soft focus:text-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
            >
              <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              <span className="absolute right-2 flex items-center">
                <SelectPrimitive.ItemIndicator>
                  <CheckIcon />
                </SelectPrimitive.ItemIndicator>
              </span>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
);

export { Select };
