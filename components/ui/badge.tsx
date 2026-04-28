import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-accent-danger/20 dark:aria-invalid:ring-accent-danger/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-surface-inverse text-text-inverse [a&]:hover:bg-surface-inverse/90",
        secondary:
          "border-transparent bg-surface-sunken text-text-primary [a&]:hover:bg-surface-sunken/90",
        destructive:
          "border-transparent bg-accent-danger text-white [a&]:hover:bg-accent-danger/90 focus-visible:ring-accent-danger/20 dark:focus-visible:ring-accent-danger/40 dark:bg-accent-danger/60",
        outline:
          "text-text-primary [a&]:hover:bg-state-hover [a&]:hover:text-text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
