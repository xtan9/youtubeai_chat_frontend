// app/(design-system)/design-system/data-display/page.tsx
"use client";

import * as React from "react";
import { Bar, BarChart, XAxis } from "recharts";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { ComponentShowcase } from "../../_components/ComponentShowcase";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";

const chartConfig: ChartConfig = {
  desktop: { label: "Desktop", color: "var(--color-accent-brand)" },
  mobile: { label: "Mobile", color: "var(--color-accent-brand-secondary)" },
};

const chartData = [
  { month: "Jan", desktop: 186, mobile: 80 },
  { month: "Feb", desktop: 305, mobile: 200 },
  { month: "Mar", desktop: 237, mobile: 120 },
  { month: "Apr", desktop: 273, mobile: 190 },
];

export default function DataDisplayPage() {
  const [calendarDate, setCalendarDate] = React.useState<Date | undefined>(
    new Date(2026, 3, 28),
  );

  return (
    <ShowcaseLayout title="Data Display">
      <ComponentShowcase name="Avatar" importPath="@/components/ui/avatar">
        <Avatar>
          <AvatarImage src="/favicon.ico" alt="" />
          <AvatarFallback>YA</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
        <Avatar className="size-12">
          <AvatarFallback>LG</AvatarFallback>
        </Avatar>
      </ComponentShowcase>

      <ComponentShowcase name="Badge" importPath="@/components/ui/badge">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </ComponentShowcase>

      <ComponentShowcase name="Table" importPath="@/components/ui/table">
        <Table className="w-full max-w-md">
          <TableCaption>Sample table</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alpha</TableCell>
              <TableCell>Active</TableCell>
              <TableCell className="text-right">12</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Beta</TableCell>
              <TableCell>Idle</TableCell>
              <TableCell className="text-right">3</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ComponentShowcase>

      <ComponentShowcase name="Progress" importPath="@/components/ui/progress">
        <Progress value={25} className="w-48" />
        <Progress value={60} className="w-48" />
        <Progress value={90} className="w-48" />
      </ComponentShowcase>

      <ComponentShowcase name="Skeleton" importPath="@/components/ui/skeleton">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-32 w-48 rounded-md" />
      </ComponentShowcase>

      <ComponentShowcase name="Calendar" importPath="@/components/ui/calendar">
        <Calendar
          mode="single"
          selected={calendarDate}
          onSelect={setCalendarDate}
          className="rounded-md border border-border-subtle"
        />
      </ComponentShowcase>

      <ComponentShowcase name="Chart" importPath="@/components/ui/chart">
        <div style={{ width: 320, height: 200 }}>
          <ChartContainer config={chartConfig}>
            <BarChart data={chartData}>
              <XAxis dataKey="month" />
              <Bar dataKey="desktop" fill="var(--color-desktop)" />
              <Bar dataKey="mobile" fill="var(--color-mobile)" />
            </BarChart>
          </ChartContainer>
        </div>
      </ComponentShowcase>

      <ComponentShowcase name="Accordion" importPath="@/components/ui/accordion">
        <Accordion type="single" collapsible className="w-64">
          <AccordionItem value="a">
            <AccordionTrigger>First item</AccordionTrigger>
            <AccordionContent>First item body.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Second item</AccordionTrigger>
            <AccordionContent>Second item body.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </ComponentShowcase>

      <ComponentShowcase name="Collapsible" importPath="@/components/ui/collapsible">
        <Collapsible className="w-64">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">Toggle</Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-body-sm mt-2">Hidden content revealed.</p>
          </CollapsibleContent>
        </Collapsible>
      </ComponentShowcase>

      <ComponentShowcase name="Toggle" importPath="@/components/ui/toggle">
        <Toggle aria-label="Toggle bold">B</Toggle>
        <Toggle aria-label="Toggle italic" defaultPressed>
          I
        </Toggle>
        <Toggle aria-label="Toggle disabled" disabled>
          U
        </Toggle>
      </ComponentShowcase>

      <ComponentShowcase name="ToggleGroup" importPath="@/components/ui/toggle-group">
        <ToggleGroup type="single" defaultValue="left">
          <ToggleGroupItem value="left" aria-label="Left">L</ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Center">C</ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Right">R</ToggleGroupItem>
        </ToggleGroup>
      </ComponentShowcase>
    </ShowcaseLayout>
  );
}
