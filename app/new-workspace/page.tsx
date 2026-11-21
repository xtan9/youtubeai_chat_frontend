import {getTranslations} from "next-intl/server";
import { WorkspaceListing } from "../workspace/_components/workspace-listing";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tr = await getTranslations("ui");
  return {title: tr("newWorkspace"), robots: {index: false, follow: false}};
}
export default function Page() {
  return <WorkspaceListing videoSpace />;
}
