import { WorkspaceListing } from "../workspace/_components/workspace-listing";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "New Workspace",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <WorkspaceListing videoSpace />;
}
