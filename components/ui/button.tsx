import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-accent-danger/20 dark:aria-invalid:ring-accent-danger/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-surface-inverse text-text-inverse shadow-xs hover:bg-surface-inverse/90",
        destructive:
          "bg-accent-danger text-white shadow-xs hover:bg-accent-danger/90 focus-visible:ring-accent-danger/20 dark:focus-visible:ring-accent-danger/40 dark:bg-accent-danger/60",
        outline:
          "border bg-surface-base shadow-xs hover:bg-state-hover hover:text-text-primary dark:bg-input/30 dark:border-border-default dark:hover:bg-input/50",
        secondary:
          "bg-surface-sunken text-text-primary shadow-xs hover:bg-surface-sunken/80",
        ghost:
          "hover:bg-state-hover hover:text-text-primary dark:hover:bg-state-hover/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
