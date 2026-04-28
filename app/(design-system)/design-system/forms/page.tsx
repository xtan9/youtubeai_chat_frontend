// app/(design-system)/design-system/forms/page.tsx
import * as React from "react";
import { ShowcaseLayout } from "../../_components/ShowcaseLayout";
import { ComponentShowcase } from "../../_components/ComponentShowcase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function FormsPage() {
  return (
    <ShowcaseLayout title="Forms">
      <ComponentShowcase name="Button" importPath="@/components/ui/button">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
      </ComponentShowcase>

      <ComponentShowcase name="Input" importPath="@/components/ui/input">
        <Input placeholder="Default input" />
        <Input type="email" placeholder="Email" />
        <Input disabled placeholder="Disabled" />
      </ComponentShowcase>

      <ComponentShowcase name="Textarea" importPath="@/components/ui/textarea">
        <Textarea placeholder="Default textarea" />
        <Textarea disabled placeholder="Disabled" />
      </ComponentShowcase>

      <ComponentShowcase name="Label" importPath="@/components/ui/label">
        <Label htmlFor="ex-input">Email</Label>
        <Label htmlFor="ex-input-2" className="text-text-muted">Optional helper</Label>
      </ComponentShowcase>

      <ComponentShowcase name="Checkbox" importPath="@/components/ui/checkbox">
        <div className="flex items-center gap-2"><Checkbox id="cb-1" /><Label htmlFor="cb-1">Default</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="cb-2" defaultChecked /><Label htmlFor="cb-2">Checked</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="cb-3" disabled /><Label htmlFor="cb-3">Disabled</Label></div>
      </ComponentShowcase>

      <ComponentShowcase name="Switch" importPath="@/components/ui/switch">
        <Switch />
        <Switch defaultChecked />
        <Switch disabled />
      </ComponentShowcase>

      <ComponentShowcase name="Slider" importPath="@/components/ui/slider">
        <Slider defaultValue={[33]} className="w-64" thumbAriaLabel="Demo slider" />
        <Slider defaultValue={[20, 80]} className="w-64" thumbAriaLabels={["Min", "Max"]} />
      </ComponentShowcase>

      <ComponentShowcase name="RadioGroup" importPath="@/components/ui/radio-group">
        <RadioGroup defaultValue="a">
          <div className="flex items-center gap-2"><RadioGroupItem value="a" id="r-a" /><Label htmlFor="r-a">Option A</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="b" id="r-b" /><Label htmlFor="r-b">Option B</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="c" id="r-c" /><Label htmlFor="r-c">Option C</Label></div>
        </RadioGroup>
      </ComponentShowcase>

      <ComponentShowcase name="Select" importPath="@/components/ui/select">
        <Select>
          <SelectTrigger className="w-48"><SelectValue placeholder="Pick one" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
            <SelectItem value="cherry">Cherry</SelectItem>
          </SelectContent>
        </Select>
      </ComponentShowcase>
    </ShowcaseLayout>
  );
}
