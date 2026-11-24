// Older saved research attempts and APIs use the original message as their identifier.
const legacyKeys: Record<string, string> = {
  "请求失败，请重试。": "spaceRequestFailed",
  "无法读取已保存的脚本，请重试。": "loadStoredScript",
  "Space 已达到保存大小上限。": "spaceSizeLimit",
  "无效的保存内容。": "invalidSave",
  "内容超出保存限制。请缩短文本后重试。": "shortenSave",
  "保存失败，请重试。": "retrySave",
  "其他窗口已更新此 Space。请复制未保存的内容，再重新打开。": "concurrentSave",
  "请求内容无效。": "invalidSpaceRequest",
  "未找到项目素材。": "missingMaterial",
  "请求过于频繁，请稍后重试。": "rateLimitedSpace",
  "暂时无法整理这份素材的摘要与出处，请重试。": "digestFailed",
  "暂时无法完成请求，请重试。": "spaceUnavailable",
  "请在原观点内继续这次调查。": "originalClaim",
  "检索已完成，但没有找到可核查的相关摘要。现有证据不足。": "noRelevantAbstract",
  "Invalid research history cursor.": "invalidResearchCursor",
  "Research history is temporarily unavailable. Please retry.": "researchUnavailable",
  "Enter a research question of 3–2,000 characters.": "researchQuestionLength",
  "Too many research requests. Please try again shortly.": "researchRateLimit",
  "Research has changed. Reload the latest judgment before updating.": "researchChanged",
  "Research question not found.": "researchNotFound",
  "Free includes one research update. Upgrade to Pro to continue this research.": "researchPlanLimit",
  "Another update is running or the research has changed. Reload and try again.": "researchInProgress",
  "The project sources or research changed. Your previous judgment is preserved; reload and retry.": "researchSourcesChanged",
  "Research could not finish. Your previous judgment is preserved. Please try again.": "researchIncomplete",
};

export function spaceNoticeKey(message: string) {
  return Object.hasOwn(legacyKeys, message) ? legacyKeys[message] : message;
}
