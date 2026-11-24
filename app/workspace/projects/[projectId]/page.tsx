import Materials from "./materials-page";
import ProjectScreen from "@/app/new-workspace/projects/[projectId]/project-screen";
export const dynamic = "force-dynamic";
export { generateMetadata } from "@/app/new-workspace/projects/[projectId]/project-screen";
type Props=Parameters<typeof ProjectScreen>[0];
export default async function Page(props:Props) {
  // Saved conversation links predate the materials subpage.
  if ((await props.searchParams).conversationId) return <Materials {...props}/>;
  return ProjectScreen({...props, base:"/workspace"});
}
