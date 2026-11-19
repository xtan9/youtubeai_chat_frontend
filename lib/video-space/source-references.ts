import type { Resource } from "./contract";

// Keep links found in the supplied material distinct from independently retrieved evidence.
export function addReference(
  resource: Resource,
  address: string,
  label: string,
  location: string,
  base?: string,
) {
  let url: URL;
  try {
    url = new URL(address, base);
  } catch {
    return;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 3000
  )
    return;
  const references = (resource.references ??= []);
  if (references.length < 80 && !references.some((r) => r.url === url.href))
    references.push({
      url: url.href,
      label: (label.trim() || url.hostname).slice(0, 300),
      location: location.slice(0, 140),
    });
}
export function textReferences(
  resource: Resource,
  text: string,
  location: string,
) {
  for (const match of text.matchAll(/https?:\/\/[^\s<>()[\]"']+/gu))
    addReference(
      resource,
      match[0].replace(/[.,;。]+$/u, ""),
      match[0],
      location,
    );
}
