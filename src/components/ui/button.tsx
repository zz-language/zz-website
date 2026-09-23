import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-b from-[#0080FF] to-[#0969DA] text-primary-foreground border border-blue-400/20 shadow-lg shadow-blue-600/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] hover:brightness-110 active:brightness-95',
        secondary:
          'bg-secondary text-secondary-foreground border border-border shadow-sm shadow-black/30 hover:bg-raised',
        outline:
          'border border-input bg-surface text-foreground shadow-sm shadow-black/30 hover:bg-raised hover:text-foreground',
        ghost: 'text-muted hover:bg-raised hover:text-foreground',
        danger:
          'border border-destructive/40 bg-surface text-destructive shadow-sm hover:bg-destructive/10',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-10 px-4',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
