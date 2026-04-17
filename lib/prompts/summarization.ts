// Transcript budget: roughly the largest chunk that keeps the prompt well
// inside Claude's context window even with the long instruction preamble
// below, while staying cost-conscious on the gateway side. Changing this
// affects cache fidelity for long videos — summaries generated under a
// different budget are still cached under the same video_id key.
const TRANSCRIPT_MAX_LENGTH = 15000;

function getEnglishPrompt(transcript: string): string {
  return `You are a professional video content analyst. Please create an in-depth, comprehensive analysis of this YouTube video content.
Analysis Requirements:
Writing Style:

Write as if analyzing a video presentation, not a transcript
Use natural language like "The video explains," "The presenter discusses," "This content covers"
Avoid repetitive references to "transcript" - treat it as video content
Focus on the information and insights presented

Analysis Depth:

Conduct thorough content analysis, not simple bullet point lists
Identify the logical structure and key arguments
Provide background information and contextual explanations
Analyze connections between different concepts

Structure Organization:

Naturally divide content into thematic sections based on the video's topics
Use descriptive titles relevant to the content (e.g., "Training Fundamentals," "Advanced Techniques," "Common Mistakes")
Each section should contain detailed explanations and supporting information
Ensure logical flow and clear hierarchy

Comprehensive Content:

Include specific data, examples, and details presented
Explain key concepts and terminology
Provide relevant context and background
Analyze different approaches or perspectives discussed

Format Requirements:

Use markdown formatting with bold headings and clear structure
Use lists and sub-lists to organize information effectively
Ensure strong readability and comprehension
Provide detailed analysis without oversimplification
If including quotes, keep them EXACTLY as spoken

Special Requirements:

Clearly highlight any recommendations or actionable advice
Note any warnings or important caveats mentioned
Maintain objective analytical perspective
Conclude with key takeaways and insights

Here is the video content to analyze:

${transcript}`;
}

function getChinesePrompt(transcript: string): string {
  return `你是一位专业的视频内容分析师。请为提供的中文内容创建深入、全面的分析总结。
总结要求：

表达方式：

以分析视频内容的方式写作，而非分析文本材料
使用自然的表达如"视频中介绍"、"主播讲解"、"这期内容涵盖"
避免重复使用"你提供的内容"、"作者认为"等表述
专注于视频传达的信息和见解

分析深度：

进行深入的内容分析，而非简单的要点罗列
识别内容的逻辑结构和论述框架
提供背景信息和上下文解释
分析观点之间的关联性

结构组织：

根据内容主题自然划分章节
使用描述性的标题（如"市场现状分析"、"策略建议"、"案例研究"等）
每个章节包含详细的子要点和支持信息
确保逻辑流畅，层次清晰

内容详实：

包含具体的数据、例子和细节
解释关键概念和术语
提供相关背景信息
分析不同观点和立场

格式要求：

使用markdown格式(**，列表符号）, 包含粗体标题和清晰的层级结构
适当使用列表和子列表组织信息
确保可读性强，便于理解和参考
总结长度要充分详细，不要过于简化
如果有引述，引述必须与原文完全一致，不要进行任何修改

特别要求：

如果内容涉及预测或建议，要明确标注
包含风险提示或注意事项（如适用）
保持客观中性的分析角度
在结尾提供总结性观点

以下是需要总结的内容：

${transcript}`;
}

export function buildSummarizationPrompt(
  transcript: string,
  language: "en" | "zh"
): string {
  const truncated = transcript.slice(0, TRANSCRIPT_MAX_LENGTH);
  // Long-video degradation is invisible without this log: the cached
  // summary is valid for the prefix but silently excludes later content,
  // so repeated hits for the same video all return the partial view.
  if (truncated.length < transcript.length) {
    console.warn("[summarization] transcript truncated to prompt budget", {
      errorId: "TRANSCRIPT_TRUNCATED",
      originalLength: transcript.length,
      truncatedLength: truncated.length,
      droppedChars: transcript.length - truncated.length,
      language,
    });
  }
  return language === "zh"
    ? getChinesePrompt(truncated)
    : getEnglishPrompt(truncated);
}
