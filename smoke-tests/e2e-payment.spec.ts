import {
  expect,
  test,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  assertPaymentE2EEnabled,
  cleanupPaymentTestPromotion,
  cleanupPaymentTestUser,
  createPaymentE2EClients,
  createPaymentTestPromotion,
  createPaymentTestUser,
  loadPaymentE2EConfig,
  type PaymentPlan,
  type PaymentTestPromotion,
  type PaymentTestUser,
  verifyStripeSubscription,
  waitForActivatedSubscription,
} from "./payment-e2e-helpers";

const enabled = process.env.PAYMENT_E2E_ENABLED?.trim() === "1";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldLocators(
  frame: Frame,
  kind: "number" | "expiry" | "cvc" | "name" | "postal",
) {
  switch (kind) {
    case "number":
      return [
        frame.getByLabel(/card number/i),
        frame.locator('input[autocomplete="cc-number"]'),
        frame.locator('input[name="cardNumber"]'),
      ];
    case "expiry":
      return [
        frame.getByLabel(/expiration|expiry/i),
        frame.locator('input[autocomplete="cc-exp"]'),
        frame.locator('input[name="cardExpiry"]'),
      ];
    case "cvc":
      return [
        frame.getByLabel(/security code|cvc|cvv/i),
        frame.locator('input[autocomplete="cc-csc"]'),
        frame.locator('input[name="cardCvc"]'),
      ];
    case "name":
      return [
        frame.getByLabel(/name on card|cardholder name/i),
        frame.locator('input[autocomplete="cc-name"]'),
        frame.locator('input[name="billingName"]'),
      ];
    case "postal":
      return [
        frame.getByLabel(/zip|postal/i),
        frame.locator('input[autocomplete="postal-code"]'),
        frame.locator('input[name="billingPostalCode"]'),
      ];
  }
}

async function firstVisiblePaymentField(
  page: Page,
  kind: "number" | "expiry" | "cvc" | "name" | "postal",
  timeoutMs: number,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const locator of fieldLocators(frame, kind)) {
        const candidate = locator.first();
        try {
          if ((await candidate.count()) > 0 && (await candidate.isVisible()))
            return candidate;
        } catch {
          // Stripe replaces Payment Element frames while it initializes.
        }
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function fillRequiredPaymentField(
  page: Page,
  kind: "number" | "expiry" | "cvc",
  value: string,
): Promise<void> {
  const field = await firstVisiblePaymentField(page, kind, 20_000);
  if (!field)
    throw new Error(`Stripe Checkout did not render the ${kind} field`);
  await field.fill(value);
}

async function fillOptionalPaymentField(
  page: Page,
  kind: "name" | "postal",
  value: string,
): Promise<void> {
  const field = await firstVisiblePaymentField(page, kind, 1_500);
  if (field) await field.fill(value);
}

async function firstVisiblePromotionControl(
  page: Page,
  kind: "toggle" | "input" | "apply",
  timeoutMs: number,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const locators =
        kind === "toggle"
          ? [
              frame.getByRole("button", { name: /add promotion code/i }),
              frame.getByText(/^add promotion code$/i),
            ]
          : kind === "input"
            ? [
                frame.getByLabel(/promotion code/i),
                frame.locator('input[name="promotionCode"]'),
                frame.locator('input[placeholder*="promotion" i]'),
              ]
            : [frame.getByRole("button", { name: /^apply$/i })];
      for (const locator of locators) {
        const candidate = locator.first();
        try {
          if ((await candidate.count()) > 0 && (await candidate.isVisible()))
            return candidate;
        } catch {
          // Stripe can replace Checkout elements while the page initializes.
        }
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function applyPromotionCode(page: Page, code: string): Promise<void> {
  // Current hosted Checkout renders the collapsed control as a visible input
  // labelled "Add promotion code". Older layouts expose a button first, so
  // keep that path as a fallback.
  let input = await firstVisiblePromotionControl(page, "input", 5_000);
  if (!input) {
    const toggle = await firstVisiblePromotionControl(page, "toggle", 15_000);
    if (!toggle)
      throw new Error("Stripe Checkout did not render Add promotion code");
    await toggle.click();
    input = await firstVisiblePromotionControl(page, "input", 10_000);
  }
  if (!input)
    throw new Error("Stripe Checkout did not render the promotion code input");
  await input.fill(code);

  const apply = await firstVisiblePromotionControl(page, "apply", 10_000);
  if (!apply)
    throw new Error(
      "Stripe Checkout did not render the promotion code Apply button",
    );
  await apply.click();
  await expect(page.getByText(/^50% off/i).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function completeStripeCheckout(
  page: Page,
  promotionCode: string,
): Promise<void> {
  await expect(page).toHaveURL(/https:\/\/checkout\.stripe\.com\//, {
    timeout: 30_000,
  });
  await applyPromotionCode(page, promotionCode);

  const cardPaymentMethod = page.getByTestId("card-accordion-item-button");
  await expect(cardPaymentMethod).toBeAttached({ timeout: 15_000 });
  await cardPaymentMethod.evaluate((button: HTMLButtonElement) =>
    button.click(),
  );

  const savePaymentInformation = page.getByRole("checkbox", {
    name: /save my information for faster checkout/i,
  });
  if (await savePaymentInformation.isChecked().catch(() => false)) {
    await savePaymentInformation.evaluate((checkbox: HTMLInputElement) =>
      checkbox.click(),
    );
    await expect(savePaymentInformation).not.toBeChecked({ timeout: 5_000 });
  }

  await fillRequiredPaymentField(page, "number", "4242424242424242");
  await fillRequiredPaymentField(page, "expiry", "1234");
  await fillRequiredPaymentField(page, "cvc", "123");
  await fillOptionalPaymentField(page, "name", "YouTubeAI Payment Test");
  await fillOptionalPaymentField(page, "postal", "94107");

  const submit = page.getByRole("button", { name: /subscribe|pay/i }).last();
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
}

async function loginPaymentTestUser(
  page: Page,
  baseUrl: string,
  user: PaymentTestUser,
): Promise<void> {
  await page.goto(`${baseUrl}/auth/login`);
  const userMenu = page.getByRole("button", { name: /user menu/i });

  // A freshly compiled Next.js dev page can render before React has attached
  // the form handler. If the browser performs the native form reload, retry
  // once after that reload has completed.
  for (const attempt of [1, 2] as const) {
    await page.getByLabel(/^email$/i).fill(user.email);
    await page.getByLabel(/^password$/i).fill(user.password);
    await page.getByRole("button", { name: /^login$/i }).click();

    try {
      await expect(userMenu).toBeVisible({
        timeout: attempt === 1 ? 5_000 : 20_000,
      });
      await page.waitForURL(
        new RegExp(`^${escapeRegExp(baseUrl)}/dashboard(?:[/?#]|$)`),
        {
          timeout: 20_000,
        },
      );
      return;
    } catch (error) {
      const loginError = page.locator("form p.text-accent-danger");
      if (await loginError.isVisible().catch(() => false)) {
        throw new Error(
          `Payment E2E login failed: ${await loginError.textContent()}`,
        );
      }
      if (attempt === 2) throw error;
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message}: ${error.errors.map(errorMessage).join("; ")}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function cleanupPaymentJourney(
  clients: ReturnType<typeof createPaymentE2EClients>,
  user: PaymentTestUser,
  promotion: PaymentTestPromotion | null,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await cleanupPaymentTestUser(clients, user);
  } catch (error) {
    errors.push(error);
  }
  if (promotion) {
    try {
      await cleanupPaymentTestPromotion(clients.stripe, promotion);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Payment E2E journey cleanup failed: ${errors.map(errorMessage).join("; ")}`,
    );
  }
}

test.describe("Stripe subscription checkout", () => {
  // The workflow uses one worker, but the tests remain independent so a
  // monthly failure does not suppress evidence from the yearly journey.
  test.describe.configure({ retries: 0 });
  test.skip(
    !enabled,
    "PAYMENT_E2E_ENABLED=1 is required for mutating payment E2E tests",
  );

  for (const plan of [
    "monthly",
    "yearly",
  ] as const satisfies readonly PaymentPlan[]) {
    test(`@payment-e2e ${plan} checkout activates Pro and opens billing portal`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      assertPaymentE2EEnabled();
      const config = loadPaymentE2EConfig();
      const clients = createPaymentE2EClients(config);
      const user = await createPaymentTestUser(clients.supabase, plan);
      let promotion: PaymentTestPromotion | null = null;
      let journeyError: unknown;

      try {
        promotion = await createPaymentTestPromotion(clients.stripe, plan);
        await loginPaymentTestUser(page, config.baseUrl, user);

        await page.goto(`${config.baseUrl}/pricing`);
        await page.getByRole("button", { name: `Choose ${plan}` }).click();
        await completeStripeCheckout(page, promotion.code);

        await page.waitForURL(
          new RegExp(`^${escapeRegExp(config.baseUrl)}/billing/success`),
          {
            timeout: 60_000,
          },
        );
        await expect(
          page.getByRole("heading", { name: "Welcome to Pro!" }),
        ).toBeVisible({
          timeout: 60_000,
        });

        const subscription = await waitForActivatedSubscription(
          clients.supabase,
          user.userId,
          plan,
        );
        await verifyStripeSubscription(
          clients.stripe,
          subscription,
          config.stripePriceIds[plan],
          promotion.promotionCodeId,
        );

        await page.goto(`${config.baseUrl}/account`);
        await expect(
          page.getByRole("heading", { name: "Account" }),
        ).toBeVisible();
        await expect(page.getByText("Pro plan", { exact: true })).toBeVisible();
        await expect(
          page.getByText(
            plan === "monthly" ? "Billed monthly" : "Billed yearly",
            {
              exact: true,
            },
          ),
        ).toBeVisible({ timeout: 20_000 });

        await page.getByRole("button", { name: "Manage subscription" }).click();
        await page.waitForURL(/https:\/\/billing\.stripe\.com\//, {
          timeout: 30_000,
        });
        await expect(page).toHaveURL(/https:\/\/billing\.stripe\.com\//);
      } catch (error) {
        journeyError = error;
      }

      try {
        await cleanupPaymentJourney(clients, user, promotion);
      } catch (cleanupError) {
        if (journeyError) {
          throw new AggregateError(
            [journeyError, cleanupError],
            `Payment E2E journey and cleanup failed: ${errorMessage(journeyError)}; ${errorMessage(cleanupError)}`,
          );
        }
        throw cleanupError;
      }
      if (journeyError) throw journeyError;
    });
  }
});
