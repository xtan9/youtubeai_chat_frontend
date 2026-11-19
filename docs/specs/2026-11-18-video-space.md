# Video Space v1 · 从两份素材到一段愿意录的开场

## Problem Statement

创作者想调查一个视频选题、判断不同来源各自说对了什么，再把发现讲成自己的话。现有 Workspace 偏向研究报告。创作者在摘要、文献、对话和草稿之间搬运材料，容易丢掉原话、出处和自己的写作节奏。

## Solution

保留 Workspace 入口，一期视频一个 Space。默认打开已确认的 A 版工作台。左边研究，中间写脚本，右边共创。作者可以先手写、先放素材或先聊。研究由作者发起，发现可随时回看，也可明确交给创作搭档。用现有 seed oil 项目从两份视频走到一段愿意录的开场。

## User Stories

1. As a creator, I want to open my existing project or start a Video Space so that each episode has a home.
2. As a writer, I want to start with an empty editor and save and reopen a handwritten script so that I can write independently of AI and sources.
3. As a creator, I want to add YouTube videos, PDFs and web pages so that my source material stays together.
4. As a researcher, I want a visible Summary control on every resource so that I can decide what deserves attention.
5. As a researcher, I want to see the most consequential claims first and expand the rest so that I can choose my angle.
6. As a researcher, I want each claim linked to its original wording and location so that I can inspect its context.
7. As a creator, I want one click to investigate a point and find relevant literature so that I can explore disagreements.
8. As a researcher, I want evidence strength and AI judgment confidence explained separately so that I can tell what each rating means.
9. As a researcher, I want to revisit findings by question across sources so that I can recover why I reached a judgment.
10. As a creator, I want research follow-ups kept in the research panel so that investigating a claim preserves my writing conversation.
11. As a writer, I want to hand a particular finding to my writing partner so that I control what enters the creative discussion.
12. As a writer, I want to highlight text and ask about “this sentence” so that I can discuss an exact passage without copying it.
13. As a writer, I want options in chat and explicit edits in the editor with undo so that I control my voice.
14. As a writer, I want a discreet source marker beside a researched sentence so that I can inspect its basis while keeping the script readable aloud.
15. As a creator, I want each side panel to collapse, maximize and restore independently so that I can change focus without losing work.

## Implementation Decisions

- Use the existing owner-scoped Workspace Project as the starting point for a Space. Preserve access to existing sources, conversations, research and artifacts when reopening an existing project. Preserve saved scripts, both conversations and evidence across reloads. Keep in-progress work intact across panel changes.
- Use existing video summaries and matching saved results. PDF and URL summaries describe the actual supplied document. Retain source anchors appropriate to the medium: timestamp, page and passage, or web passage. Indicate unreadable or unavailable content.
- Import only organizes the resource. Show its summary, references and top 3–5 claims, total count and access to the rest. Mark claims awaiting independent investigation. Opening a summary or typing in a script triggers no external research.
- “继续深究” or a research request in the research conversation investigates that question. Use the existing literature retrieval and citation validation where applicable. Inspect supporting, challenging and qualifying evidence. Show the source scope actually examined, including abstract-only coverage.
- Supported, problematic and open categories may be empty. Show evidence strength with direction and reason, plus the AI’s confidence in its specific judgment with a separate reason. Distinguish provider failure, insufficient evidence and a completed review finding no clear error.
- The left research conversation and right writing conversation are independent. Opening a claim replaces the desk with its claim space. The source directory is on the left, evidence and discussion for that claim are in the middle, and the same editable script moves to the right. Hide the project writing partner until the creator returns to the desk, retaining its unsent input. “交给创作搭档” transfers the selected finding with its question and provenance. The right conversation continues across drafts in the same Space.
- Preserve a selected passage when the editor loses focus. Show its reference in chat, with a way to remove it. Messages retain the exact quoted text and originating draft. Offer contextual writing actions on selection. A question or ambiguous instruction defaults to discussion. A clear request to write or rewrite edits the document, preserves surrounding manual work and supports one-step undo. Offer alternatives in chat until chosen. A stale suggestion must not overwrite intervening manual edits.
- Keep evidence accessible from each resource, by research question in the evidence view and from the relevant sentence in the script. A handoff alone never inserts prose into the script.

### Approved UI and allowed polish

The six pinned images in Further Notes are the visual reference. Use the same content and interaction state for comparisons. At 1440 × 900 the reference measures approximately 358 / 591 / 376 CSS pixels for research / editor / writing partner, with 14 px gaps. Preserve this relative emphasis and left-to-right order. These dimensions are comparison anchors rather than fixed widths for all screens.

- First view: Workspace header, episode title, then three sibling panels. The center script is the widest. Each resource shows an explicit summary toggle beside its title, and the first material’s claims are expanded. Summary and claims have separate controls.
- On the project desk, open a claim from its source. In its space, keep the claim’s evidence, follow-ups and retries together. A script citation opens its exact finding. Switching claims retains the script and each claim’s unsent question. Keep selection-aware writing chat on the right of the project desk. Both panel headers expose collapse and maximize actions. Collapsed panels leave recoverable edge controls; maximized panels offer restore. Restoring returns to the author’s work with the previous conversation, source state, text and pending input intact.
- Refine typography, colors, spacing, contrast, focus states and icons using the product design system. Keep source anchors light, prose readable, and actions discoverable. No walkthrough footer, test labels, mock-data picker or A/B switcher in the shipped interface. Use the normal import control in place of the prototype picker.
- On narrow screens preserve access to all three activities and their state, with reachable controls and no horizontal overflow. The narrow capture documents source density and content; exact desktop proportions apply only on desktop.

## Testing Decisions

The agreed primary acceptance surface is the signed-in browser journey on the existing seed oil Space. Follow the prior Workspace browser journeys for reload and owner isolation, and existing research retrieval and citation contract coverage for failures and traceable sources. Use controlled responses for repeatable comparisons and verify live retrieval separately. Evaluate what the creator sees, edits and can reopen.

1. Open the existing project and confirm prior materials remain accessible. Type a first sentence manually. Add or reuse two real videos, a PDF and a web page. Open all four summaries, including an already summarized video. Confirm source opening, import and manual typing do not start an external investigation.
2. In a video, inspect an attributed claim at its timestamp. Investigate an apparent disagreement. Follow a real publication link and inspect both ratings and reasons. Confirm the investigation and follow-up stay in the selected claim space while a pending creative message is retained on the desk. Revisit the finding by question.
3. Hand the finding to the writing partner. Ask it to continue from the handwritten opening, inspect the source marker, discuss selected text, request a targeted edit, undo and write the last line manually. Reopen the Space and confirm the script, separate conversations, finding and references remain accessible.
4. Independently collapse, maximize and restore both sides, including both collapsed together. Check keyboard reachability, retained input and selected passage. Verify a failed lookup preserves the draft and prior findings and is distinguishable from an evidence gap.
5. **Visual acceptance for the implementation PR:** attach side-by-side reference and implementation captures of the six states below. Match CSS viewport, zoom (100%), content, open panels and scroll position. At desktop compare panel order, relative widths, visible Summary, conversation destination, selected panel and restore affordances. At 390 px verify controls remain reachable and the document does not overflow. Record and resolve structural discrepancies before calling the UI accepted. Obtain creator review for intentional changes to layout or interaction hierarchy. Pixel differences from approved visual polish are expected.
6. Report fixture runs, deployed browser checks and any remaining live-verification gap separately. The prototype’s simulated investigation does not satisfy production acceptance.

## Out of Scope

Novel and article Space types, exhaustive research on import, automatic factual surveillance of manual edits, production layout selection between A and B, and automatic transfer of the whole research conversation into writing chat.

## Further Notes

Approved prototype revision: [parallel video Space](https://github.com/xtan9/youtubeai_chat_frontend/tree/067ee4a284293f315afe37656e01ee77dea396f9/app/workspace/projects/%5BprojectId%5D/video-space.prototype). The pinned images are the design baseline, not screenshots of the implemented feature.

- [默认三栏](https://github.com/xtan9/youtubeai_chat_frontend/blob/067ee4a284293f315afe37656e01ee77dea396f9/docs/specs/assets/video-space-v1/workbench.png)
- [左侧深究](https://github.com/xtan9/youtubeai_chat_frontend/blob/067ee4a284293f315afe37656e01ee77dea396f9/docs/specs/assets/video-space-v1/investigation.png)
- [研究台最大化](https://github.com/xtan9/youtubeai_chat_frontend/blob/067ee4a284293f315afe37656e01ee77dea396f9/docs/specs/assets/video-space-v1/research-max.png)
- [创作搭档最大化](https://github.com/xtan9/youtubeai_chat_frontend/blob/067ee4a284293f315afe37656e01ee77dea396f9/docs/specs/assets/video-space-v1/writer-max.png)
- [双侧收起](https://github.com/xtan9/youtubeai_chat_frontend/blob/067ee4a284293f315afe37656e01ee77dea396f9/docs/specs/assets/video-space-v1/writing.png)
- [窄屏窄栏](https://github.com/xtan9/youtubeai_chat_frontend/blob/067ee4a284293f315afe37656e01ee77dea396f9/docs/specs/assets/video-space-v1/narrow.png)
