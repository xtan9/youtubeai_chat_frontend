import ProjectScreen, { type ProjectPageProps } from "./project-screen";
export { generateMetadata } from "./project-screen";
export const dynamic = "force-dynamic";

export default function Page(props: ProjectPageProps) {
  return ProjectScreen(props, "/new-workspace");
}
