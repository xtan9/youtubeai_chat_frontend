import {expect, test} from "@playwright/test";
import en from "../i18n/messages/en.json";
import zh from "../i18n/messages/zh.json";
import tw from "../i18n/messages/zh-TW.json";

test("signed-in route copy follows the selected locale across the full visible page", async ({page}) => {
  test.skip(!process.env.TEST_LIVE_SUMMARY_EMAIL || !process.env.TEST_LIVE_SUMMARY_PASSWORD, "Requires the production smoke account");
  test.setTimeout(220000);
  const base = process.env.BASE_URL || "http://localhost:3000";
  await page.goto(base+"/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url=>["/","/dashboard"].includes(url.pathname));
  function flatten(value: unknown): string[] {
    if (typeof value === "string") return [value];
    return value && typeof value === "object" ? Object.values(value).flatMap(flatten) : [];
  }
  const admin = await page.request.get(base+"/admin", {maxRedirects: 0});
  console.log("Admin route status for the smoke account", admin.status(), admin.headers().location?.split("?")[0] ?? "");
  const english = new Set(flatten(en));
  const visibleCopy = () => page.evaluate(()=>{
    const result=new Set<string>();
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let text;
    while(text=walker.nextNode()){
      const parent=text.parentElement;
      if(!parent || !parent.checkVisibility() || parent.closest('script,style,noscript,option,textarea,[hidden],[aria-hidden=true],.sr-only'))continue;
      const range=document.createRange();range.selectNodeContents(text);
      if(range.getBoundingClientRect().width)result.add(text.textContent!.replace(/\s+/g," ").trim());
    }
    for(const input of document.querySelectorAll('input[placeholder],textarea[placeholder]')){
      if(input.checkVisibility())result.add(input.getAttribute("placeholder")!);
    }
    return [...result].filter(Boolean);
  });
  for(const path of ["/","/dashboard","/workspace","/new-workspace","/history","/account","/account/billing","/auth/update-password","/billing/success","/billing/canceled","/pricing","/summary?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw"]){
    await page.goto(base+path);
    const language=page.locator("header select").first();
    const switchTo=async(locale:string)=>{
      await language.selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
      if(path.startsWith("/summary?"))await expect(page.getByTestId("summary-markdown-surface")).toBeVisible({timeout:120000});
    };
    await switchTo("en");
    const englishUI=(await visibleCopy()).filter(s=>english.has(s)&&/[A-Za-z]/.test(s));
    for(const locale of ["zh","zh-TW"]){
      await switchTo(locale);
      const translated = new Set(flatten(locale==="zh"?zh:tw));
      await expect.poll(async()=> {
        const current = new Set(await visibleCopy());
        return englishUI.filter(s=>!translated.has(s)&&current.has(s));
      },{message:path+" "+locale+" visible English interface copy"}).toEqual([]);
    }
    console.log("Checked visible catalog text in English, Simplified and Traditional Chinese",new URL(base+path).pathname,englishUI.length);
  }
});
