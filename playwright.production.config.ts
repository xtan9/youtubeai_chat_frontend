import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

// Production smoke verifies the deployed application only. These specs either
// start their own local Next.js/Supabase fixture servers or exercise a
// development-only prototype, so retargeting them with BASE_URL changes their
// meaning and produces false production incidents.
export default defineConfig(baseConfig, {
  testIgnore: [
    /e2e-admin-report-completeness\.spec\.ts$/,
    /e2e-anonymous-trial-analytics\.spec\.ts$/,
    /e2e-evidence-workspace-prototype\.spec\.ts$/,
    /e2e-global-plan-control\.spec\.ts$/,
    /e2e-project-adoption\.spec\.ts$/,
    /e2e-subscription-funnel-report\.spec\.ts$/,
    /e2e-workspace\.spec\.ts$/,
  ],
  webServer: undefined,
});
