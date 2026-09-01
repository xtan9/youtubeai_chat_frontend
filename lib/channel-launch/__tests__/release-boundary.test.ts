import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

function productionFiles(relativeDirectory: string): string[] {
  const directory = path.join(ROOT, relativeDirectory);
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionFiles(relativePath));
    } else if (
      /\.(?:ts|tsx)$/u.test(entry.name) &&
      !relativePath.includes(`${path.sep}__tests__${path.sep}`) &&
      !relativePath.endsWith(".test.ts") &&
      !relativePath.endsWith(".test.tsx")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

describe("Channel launch packet release boundary", () => {
  it("does not expose the packet or inert Channel experience through production routes", () => {
    expect(existsSync(path.join(ROOT, "app", "channel"))).toBe(false);

    const productionConsumers = [
      ...productionFiles("app"),
      ...productionFiles("components"),
    ];
    const launchImports = productionConsumers.filter((file) =>
      /(?:from|import\()\s*["'](?:@\/)?lib\/channel-launch(?:["'/])/u.test(
        readFileSync(path.join(ROOT, file), "utf8"),
      ),
    );

    expect(launchImports).toEqual([]);

    const channelRouteReferences = productionConsumers.filter((file) =>
      /["'`]\/channel(?:[\/?#"'`]|$)/u.test(
        readFileSync(path.join(ROOT, file), "utf8"),
      ),
    );

    expect(channelRouteReferences).toEqual([]);
  });
});
