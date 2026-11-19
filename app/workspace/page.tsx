import type { Metadata } from "next";
import { WorkspaceListing } from "./_components/workspace-listing";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workspace - YouTube AI Chat",
  description: "Resume and organize your private YouTube research Projects.",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage() {
  return <WorkspaceListing />;
}
