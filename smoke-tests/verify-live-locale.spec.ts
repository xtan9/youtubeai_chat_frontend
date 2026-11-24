import { expect, test } from "@playwright/test";

test("signed-in pages update in place and remember the interface language", async ({page}) => {
  test.setTimeout(180_000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));

  const headings = {
    dashboard: ["最近观看", "最近觀看", "Recent"],
    history: ["你的摘要", "你的摘要", "Your summaries"],
    "account/billing": ["方案与账单", "方案與帳單", "Plan & Billing"],
    "billing/canceled": ["结账已取消", "結帳已取消", "No worries"],
    "billing/success": ["无法验证结账结果", "無法驗證結帳結果", "Checkout return unavailable"],
    account: ["账户", "帳戶", "Account"],
  };
  for (const [path, labels] of Object.entries(headings)) {
    await page.goto(base + "/" + path);
    for (const [index, locale] of ["zh", "zh-TW", "en"].entries()) {
      await page.locator("header select").selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", {name:labels[index], exact:true})).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", {name:labels[index], exact:true})).toBeVisible();
      await expect(page.locator("header select")).toHaveValue(locale);
    }
  }
  await page.goto(base + "/history");
});

test("mobile workspace, menu and project editor follow the selected interface language", async ({page}) => {
  test.setTimeout(180_000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));

  await page.setViewportSize({width:390, height:844});
  await page.goto(base+"/new-workspace");
  let temp;
  try {
    const first = page.locator('a[href^="/new-workspace/projects/"]').first();
    if (!await first.count()) {
      const r = await page.request.post(base+"/api/workspace/projects",{data:{name:"Localization acceptance "+Date.now(),goal:""}});
      expect(r.ok()).toBeTruthy();
      temp=(await r.json()).project.id;
      await page.reload();
    }
    for(const [lang, heading, editor] of [["zh","视频项目","脚本正文"],["zh-TW","影片專案","腳本正文"],["en","Video Spaces","Script text"]]){
      await page.goto(base+"/dashboard");
      await page.locator('[aria-controls="mobile-primary-navigation"]').click();
      await page.locator("header select").selectOption(lang);
      await expect(page.locator("html")).toHaveAttribute("lang",lang);
      console.log(lang,"mobile menu", await page.locator("#mobile-primary-navigation").allInnerTexts());
      await page.goto(base+"/new-workspace");
      await expect(page.getByRole("heading",{name:heading,exact:true})).toBeVisible();
      await first.click();
      await expect(page.getByRole("textbox",{name:editor})).toBeAttached();
      console.log(lang,"mobile project width",await page.evaluate(()=>document.documentElement.scrollWidth));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang",lang);
      await expect(page.getByRole("textbox",{name:editor})).toBeAttached();
    }
  } finally {
    if (temp) expect((await page.request.delete(base+"/api/projects/"+temp)).status()).toBe(204);
  }
});

test("real summary retains source content across language changes and history reopen", async ({page}) => {
  test.setTimeout(230000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));
  await page.goto(base + "/dashboard");
  await page.locator("input[name=url]").fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await page.locator("input[name=url]").press("Enter");
  await page.waitForURL(url=>url.pathname==="/summary");
  const reading = page.getByTestId("summary-markdown-surface");
  await expect(reading).toBeVisible({timeout:135000});
  const source = await reading.innerText();
  expect(source.length).toBeGreaterThan(30);
  for (const [locale,summary,chat] of Array(3).fill([["zh","摘要","对话"],["zh-TW","摘要","對話"],["en","Summary","Chat"]]).flat()) {
    await page.locator("header select").selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang",locale);
    await page.getByRole("tab",{name:chat,exact:true}).click();
    await page.getByRole("tab",{name:summary,exact:true}).click();
    await expect(reading).toHaveText(source,{useInnerText:true});
  }
  console.log("Verified summary and chat tabs and preserved summary body");
  await page.goto(base + "/history");
  const link = page.locator('a[href^="/summary?url="][href*="jNQXAC9IVRw"]').first();
  console.log("History state", JSON.stringify({
    path:new URL(page.url()).pathname,summaryLinks:await page.locator('a[href*="/summary?"]').count(),
    headings:await page.locator("main h1,main h2").allInnerTexts(),
    alert:await page.locator("main [role=alert]").allInnerTexts(),
    unavailable:await page.getByText(/couldn.t load|could not load|unable to load/i).count(),
  }));
  await expect(link).toBeVisible();
  await link.click();
  await expect(reading).toHaveText(source,{useInnerText:true});
});

test("desktop legacy project localizes visible draft names and preserves authored text", async ({page}) => {
  test.setTimeout(100_000);
  const base = "https://www.youtubeai.chat";
  await page.setViewportSize({width:1680, height:1000});
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));
  const name = "旧项目标题验收 " + Date.now();
  const manuscript = "观众写下的开场文字";
  const creation = await page.request.post(base + "/api/workspace/projects", {data:{name, goal:""}});
  expect(creation.ok(), String(creation.status())).toBeTruthy();
  const {project:{id}} = await creation.json();
  const endpoint = base + "/api/projects/" + id;
  try {
    const seeded = await page.request.put(endpoint + "/space", {data:{
      revision:0, document:{drafts:[
        {id:"opening",title:"开场脚本",text:manuscript,markers:[]},
        {id:"second",title:"脚本 2",text:"",markers:[]},
        {id:"custom",title:"我的手写标题",text:"",markers:[]},
      ], resources:[], messages:[]},
    }});
    expect(seeded.ok(),String(seeded.status())).toBeTruthy();
    await page.goto(base + "/new-workspace/projects/" + id);
    const locale = page.locator("header select");
    const drafts = page.locator(".vs-meta select");
    for (const [lang,opening,second] of [
      ["en","Opening script","Script 2"],["zh","开场脚本","脚本 2"],
      ["zh-TW","開場腳本","腳本 2"],["en","Opening script","Script 2"],
    ]) {
      await locale.selectOption(lang);
      await expect(page.getByRole("heading",{name:opening,exact:true})).toBeVisible();
      await expect(drafts.locator("option:checked")).toHaveText(opening);
      await expect(drafts.locator('option[value="second"]')).toHaveText(second);
      await expect(drafts.locator('option[value="custom"]')).toHaveText("我的手写标题");
      await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
      await expect(page.locator(".vs-manuscript textarea")).toHaveValue(manuscript);
    }
    await page.reload();
    await expect(drafts.locator("option:checked")).toHaveText("Opening script");
    await drafts.selectOption("second");
    await expect(page.getByRole("heading",{name:"Script 2",exact:true})).toBeVisible();
    await drafts.selectOption("custom");
    await expect(page.getByRole("heading",{name:"我的手写标题",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"New script",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Script 4",exact:true})).toBeVisible();
    await locale.selectOption("zh");
    await expect(drafts.locator("option:checked")).toHaveText("脚本 4");
    await expect(page.locator(".vs-meta [role=status]")).toHaveText("已保存");
    await page.reload();
    await expect(page.getByRole("heading",{name:"脚本 4",exact:true})).toBeVisible();
    await locale.selectOption("en");
    await expect(drafts.locator("option:checked")).toHaveText("Script 4");
  } finally {
    expect((await page.request.delete(endpoint)).ok()).toBeTruthy();
  }
});

test("legacy materials, excerpts and conversation defaults switch in place", async ({page}) => {
  test.setTimeout(160000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/","/dashboard"].includes(url.pathname));
  const name = "自定义项目名称 " + Date.now();
  const result = await page.request.post(base+"/api/workspace/projects",{data:{name, goal:"自己的研究目标"}});
  expect(result.status()).toBe(201);
  const id=(await result.json()).project.id;
  const target=base+"/api/projects/"+id;
  try {
    const seeded=await page.request.put(target+"/space",{data:{revision:0,document:{
      drafts:[{id:"opening",title:"开场脚本",text:"手写开场",markers:[]}],
      resources:[{id:"old-pdf",title:"原始素材名称",kind:"pdf",analyzed:true,coverage:"已提取 1 页文字摘录 · 原文共 7 页",
        pages:[{label:"第 4 页",text:"原文保持原样"}],
        references:[{url:"https://example.org/study",label:"引用作者的标题",location:"第 4 页"}]}],messages:[]}}});
    expect(seeded.ok()).toBeTruthy();
    expect((await page.request.post(target+"/conversations",{data:{}})).ok()).toBeTruthy();
    await page.goto(base+"/new-workspace/projects/"+id);
    const lang=page.locator("header select").first();
    await lang.selectOption("en");
    await page.getByRole("button",{name:"Summary +",exact:true}).click();
    await page.getByText("Excerpts",{exact:true}).click();
    await page.locator(".vs-digest details summary").first().click();
    for(const [locale,opening,loc,coverage] of [
      ["en","Opening script","Page 4","Extracted text from 1 of 7 pages."],
      ["zh","开场脚本","第 4 页","已提取 1 页文字摘录 · 原文共 7 页"],
      ["zh-TW","開場腳本","第 4 頁","已提取 1 頁文字摘錄 · 原文共 7 頁"],
    ]){
      await lang.selectOption(locale);
      await expect(page.getByRole("heading",{name:opening,exact:true})).toBeVisible();
      await expect(page.getByText(coverage,{exact:true})).toBeVisible();
      await expect(page.locator(".vs-digest b")).toHaveText(loc);
      await expect(page.locator(".vs-digest small")).toHaveText(loc);
      await expect(page.getByRole("link",{name:/引用作者的标题/})).toBeVisible();
      await expect(page.getByText("原文保持原样",{exact:false}).last()).toBeVisible();
    }
    await page.goto(base+"/workspace/projects/"+id);
    for (const [locale,research,outputs,search,settings,thread,details,action,outputTitle,sourceButton] of [
      ["en","Research","Outputs","Search","Settings","New conversation","Project details","Compare viewpoints","Study Guide","Add from History"],
      ["zh","研究","成果","搜索","设置","新对话","项目详情","比较观点","学习指南","从历史记录添加"],
      ["zh-TW","研究","成果","搜尋","設定","新對話","專案詳情","比較觀點","學習指南","從歷史記錄添加"],
    ]) {
      await lang.selectOption(locale);
      await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
      await page.getByRole("tab",{name:research,exact:true}).click();
      await expect(page.getByRole("list").getByText(thread,{exact:true})).toBeVisible();
      await page.getByRole("button",{name:action,exact:true}).click();
      await expect(page.locator("#project-question")).not.toBeEmpty();
      await page.getByRole("tab",{name:outputs,exact:true}).click();
      await expect(page.getByRole("heading",{name:outputTitle,exact:true})).toBeVisible();
      await page.getByRole("tab",{name:search,exact:true}).click();
      await expect(page.locator('input:visible').first()).toBeVisible();
      await page.getByRole("tab",{name:settings,exact:true}).click();
      await expect(page.getByRole("heading",{name:details,exact:true})).toBeVisible();
      await page.getByRole("button",{name:sourceButton,exact:true}).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.reload();
    await expect(lang).toHaveValue("zh-TW");
    await expect(page.getByRole("tab",{name:"設定",exact:true})).toBeVisible();
  } finally {
    expect((await page.request.delete(target)).status()).toBe(204);
  }
});
