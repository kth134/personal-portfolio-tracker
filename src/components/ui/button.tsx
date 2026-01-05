import React from 'react'
import { cva } from 'class-variance-authority'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary'
  children: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', className = '', ...props }, ref) => {
    const baseStyles = 'px-4 py-2 rounded font-medium transition-colors'
    
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",  // Add/ensure this
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // ... size etc.
    },
    defaultVariants: {
      variant: "default",
      // ...
    },
  }
)
    
    return (
      <button
        ref={ref}
        className={buttonVariants({ variant, className })}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'