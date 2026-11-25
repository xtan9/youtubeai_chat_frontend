import Materials from "./materials-page";
import ProjectScreen, { type ProjectPageProps } from "@/app/new-workspace/projects/[projectId]/project-screen";
export const dynamic = "force-dynamic";
export { generateMetadata } from "@/app/new-workspace/projects/[projectId]/project-screen";
export default async function Page(props: ProjectPageProps) {
  // Saved conversation links predate the materials subpage.
  if ((await props.searchParams).conversationId) return <Materials {...props} />;
  return ProjectScreen(props, "/workspace");
}
