import "server-only";
import { lookup } from "node:dns/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { addReference } from "./source-references";
import type { Resource } from "./contract";

// Connect to the validated public address. Resolve each redirect independently.
async function download(
  url: URL,
  signal: AbortSignal,
  remaining = 3,
): Promise<{ html: string; url: URL }> {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw Error("Unsupported URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => ipaddr.process(address).range() !== "unicast",
    )
  )
    throw Error("Private address");
  const { address, family } = addresses[0];
  const get = url.protocol === "https:" ? httpsGet : httpGet;
  const response = await new Promise<import("node:http").IncomingMessage>(
    (resolve, reject) => {
      get(
        {
          hostname: address,
          family,
          servername: isIP(host) ? undefined : host,
          headers: { Host: url.host, Accept: "text/html,text/plain" },
          path: url.pathname + url.search,
          signal,
          agent: false,
        },
        resolve,
      ).on("error", reject);
    },
  );
  if (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    remaining &&
    response.headers.location
  ) {
    response.destroy();
    return download(
      new URL(response.headers.location, url),
      signal,
      remaining - 1,
    );
  }
  if (
    response.statusCode !== 200 ||
    !/^text\/(html|plain)\b/i.test(response.headers["content-type"] ?? "")
  ) {
    response.destroy();
    throw Error("Unavailable page");
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw Error("Page too large");
    chunks.push(chunk);
  }
  return { html: Buffer.concat(chunks).toString("utf8"), url };
}

export async function readWebPage(
  address: string,
  signal: AbortSignal,
): Promise<Resource> {
  const url = new URL(address);
  const resource: Resource = {
    id: crypto.randomUUID(),
    kind: "web",
    url: url.href,
    title: url.hostname,
    pages: [],
    coverage: "无法读取网页正文",
  };
  try {
    const { html, url: finalUrl } = await download(
      url,
      AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    );
    const $ = load(html);
    resource.title =
      $("title").first().text().trim().slice(0, 1000) || url.hostname;
    $("script,style,nav,header,footer,aside,noscript,template").remove();
    const root = $("article").first().length
      ? $("article").first()
      : $("main").first().length
        ? $("main").first()
        : $("body");
    root
      .find("p a[href],li a[href],cite a[href],blockquote a[href]")
      .each((_, a) => {
        const href = $(a).attr("href");
        if (href && !href.startsWith("#"))
          addReference(resource, href, $(a).text(), "网页正文", finalUrl.href);
      });
    const blocks = root
      .find("p,li,h2,h3,blockquote")
      .toArray()
      .map((n) => $(n).text());
    if (!blocks.length) blocks.push(root.text());
    let budget = 60000;
    for (const block of blocks) {
      if (budget <= 0 || resource.pages.length >= 200) break;
      const text = block
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, Math.min(16000, budget));
      if (text) {
        resource.pages.push({
          label: "段落 " + (resource.pages.length + 1),
          text,
        });
        budget -= text.length;
      }
    }
    if (resource.pages.length)
      resource.coverage = "已读取网页摘录 · " + resource.pages.length + " 段";
  } catch {
    signal.throwIfAborted();
  }
  return resource;
}
