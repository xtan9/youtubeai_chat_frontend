// app/(design-system)/design-system/containers/page.tsx
import * as React from "react";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { ComponentShowcase } from "../../_components/ComponentShowcase";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";

export default function ContainersPage() {
  return (
    <ShowcaseLayout title="Containers">
      <ComponentShowcase name="Card" importPath="@/components/ui/card">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description sits here.</CardDescription>
          </CardHeader>
          <CardContent>Card body content.</CardContent>
          <CardFooter>
            <Button size="sm">Action</Button>
          </CardFooter>
        </Card>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Minimal card</CardTitle>
          </CardHeader>
          <CardContent>Just a body.</CardContent>
        </Card>
      </ComponentShowcase>

      <ComponentShowcase name="Alert" importPath="@/components/ui/alert">
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>This is a default alert.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Something went wrong.</AlertDescription>
        </Alert>
      </ComponentShowcase>

      <ComponentShowcase name="AlertDialog" importPath="@/components/ui/alert-dialog">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Open alert dialog</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ComponentShowcase>

      <ComponentShowcase name="Dialog" importPath="@/components/ui/dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog title</DialogTitle>
              <DialogDescription>Dialog description.</DialogDescription>
            </DialogHeader>
            <p className="text-body-sm">Dialog body content.</p>
            <DialogFooter>
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ComponentShowcase>

      <ComponentShowcase name="Sheet" importPath="@/components/ui/sheet">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet title</SheetTitle>
              <SheetDescription>Sheet description.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </ComponentShowcase>

      <ComponentShowcase name="Drawer" importPath="@/components/ui/drawer">
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Drawer title</DrawerTitle>
              <DrawerDescription>Drawer description.</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <Button>Confirm</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </ComponentShowcase>

      <ComponentShowcase name="Popover" importPath="@/components/ui/popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent>Popover content.</PopoverContent>
        </Popover>
      </ComponentShowcase>

      <ComponentShowcase name="Tooltip" importPath="@/components/ui/tooltip">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </ComponentShowcase>

      <ComponentShowcase name="HoverCard" importPath="@/components/ui/hover-card">
        <HoverCard>
          <HoverCardTrigger asChild>
            <Button variant="link">@yt-ai</Button>
          </HoverCardTrigger>
          <HoverCardContent>
            <p className="text-body-sm">Hover card content.</p>
          </HoverCardContent>
        </HoverCard>
      </ComponentShowcase>

      <ComponentShowcase name="ScrollArea" importPath="@/components/ui/scroll-area">
        <ScrollArea className="h-32 w-48 rounded-md border border-border-subtle p-4">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 20 }).map((_, i) => (
              <p key={i} className="text-body-sm">
                Item {i + 1}
              </p>
            ))}
          </div>
        </ScrollArea>
      </ComponentShowcase>

      <ComponentShowcase name="Separator" importPath="@/components/ui/separator">
        <div className="flex flex-col gap-2 w-48">
          <span className="text-body-sm">Above</span>
          <Separator />
          <span className="text-body-sm">Below</span>
        </div>
        <div className="flex h-12 items-center gap-2">
          <span className="text-body-sm">Left</span>
          <Separator orientation="vertical" />
          <span className="text-body-sm">Right</span>
        </div>
      </ComponentShowcase>

      <ComponentShowcase name="AspectRatio" importPath="@/components/ui/aspect-ratio">
        <div className="w-48">
          <AspectRatio ratio={16 / 9} className="bg-surface-sunken rounded-md" />
        </div>
        <div className="w-32">
          <AspectRatio ratio={1} className="bg-surface-sunken rounded-md" />
        </div>
      </ComponentShowcase>

      <ComponentShowcase name="Resizable" importPath="@/components/ui/resizable">
        <ResizablePanelGroup
          direction="horizontal"
          className="w-64 h-32 rounded-md border border-border-subtle"
        >
          <ResizablePanel defaultSize={50}>
            <div className="p-2 text-body-sm">Left</div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50}>
            <div className="p-2 text-body-sm">Right</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ComponentShowcase>
    </ShowcaseLayout>
  );
}
