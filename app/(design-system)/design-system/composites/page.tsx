// app/(design-system)/design-system/composites/page.tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { ComponentShowcase } from "../../_components/ComponentShowcase";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";

export default function CompositesPage() {
  return (
    <ShowcaseLayout title="Composites">
      <ComponentShowcase name="Carousel" importPath="@/components/ui/carousel">
        <Carousel className="w-64">
          <CarouselContent>
            {[1, 2, 3, 4, 5].map((n) => (
              <CarouselItem key={n}>
                <div className="flex h-32 items-center justify-center rounded-md border border-border-subtle bg-surface-raised">
                  <span className="text-h3">{n}</span>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </ComponentShowcase>

      <ComponentShowcase name="Sonner" importPath="@/components/ui/sonner">
        <Button onClick={() => toast("Default toast")}>Show toast</Button>
        <Button
          variant="outline"
          onClick={() => toast.success("Success toast")}
        >
          Success
        </Button>
        <Button
          variant="destructive"
          onClick={() => toast.error("Error toast")}
        >
          Error
        </Button>
        <Toaster />
      </ComponentShowcase>
    </ShowcaseLayout>
  );
}
