# Evidence Check beta: YouTube policy and legal launch constraints

**Research date:** 2026-08-10
**Decision ticket:** [#386](https://github.com/xtan9/youtubeai_chat_frontend/issues/386)
**Product map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)
**Status:** Decision research, not legal advice

## Decision

**Do not open the Evidence Check beta to Learners yet.** Internal prototyping and evaluation may proceed only on a rights-cleared corpus, but public use should remain blocked until all three gates below are satisfied:

1. **Transcript gate:** document a transcript-acquisition path that does not scrape YouTube, obtain scraped YouTube content, or download/extract YouTube audiovisual content without the necessary permission. The repository's current `/captions` and `/transcribe` service contract does not itself establish that permission.
2. **YouTube gate:** submit the exact Evidence Check data flow for a YouTube API Compliance Audit and obtain written confirmation that the claim-level findings may be displayed beside YouTube API Data. The June 2026 derived-metrics amendment is relevant but does not clearly authorize a finding produced by combining a Video's words with external evidence.
3. **Legal/editorial gate:** obtain counsel approval for the initial countries, report wording, source-use rules, privacy notices, correction/takedown process, and insurance/risk posture. A feature flag controls access, but it does not resolve publication, copyright, privacy, or jurisdiction risk.

The current product decisions in #381 are directionally correct and materially reduce risk: keep the beta claim-level rather than person-level; omit the numeric score; limit it to public, low-risk, transcript-verifiable Videos; make reports private to the requesting authenticated Learner; and abstain aggressively. The beta also needs several additional exclusions and operating controls described below.

## Classification of findings

| Status | Meaning in this report |
| --- | --- |
| **Verified requirement** | The cited contract, policy, statute, or regulation states the rule directly. |
| **Risk inference** | The rule's application to Evidence Check is plausible but not conclusively resolved by the source. |
| **Needs approval/counsel** | YouTube or qualified counsel must resolve the ambiguity before launch. |
| **Conservative recommendation** | A product constraint that lowers exposure but is not presented as a legal safe harbor. |

## Launch-blocker matrix

| Area | Finding | Status | Launch consequence |
| --- | --- | --- | --- |
| Public transcripts | The Data API does not provide a general public-caption download endpoint. `captions.list` requires OAuth and does not return caption text; `captions.download` requires the user to have permission to edit the Video. ([list](https://developers.google.com/youtube/v3/docs/captions/list), [download](https://developers.google.com/youtube/v3/docs/captions/download)) | Verified requirement | Do not describe ordinary public captions as available through the official API. |
| Scraping | API Clients must not directly or indirectly scrape YouTube Applications or obtain scraped YouTube data/content. YouTube's general Terms also bar automated access except public-search-engine access under `robots.txt` or prior written permission. ([Developer Policies III.E.6](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content), [YouTube Terms](https://www.youtube.com/static?template=terms)) | Verified requirement | A transcript vendor that scrapes YouTube is not a compliant workaround. Require provenance evidence and contractual warranties, then independently audit the path. |
| Audio transcription | API Clients may not download, import, back up, cache, or store YouTube audiovisual content without prior written approval. The compliance guide also says not to download or separate audio tracks. ([Developer Policies III.E.1](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content), [compliance guide](https://developers.google.com/youtube/terms/developer-policies-guide#your_api_service_must_reflect_a_users_standard_experience_on_youtube)) | Verified requirement | Do not use a Whisper fallback that obtains or separates YouTube audio unless YouTube and applicable rights holders authorize that exact flow. |
| Derived findings | An API Client must not use API Data to create new or derived data or metrics. If non-API information is displayed alongside API Data, a clear, prominent disclosure must say it is not from YouTube and is part of the developer's product. ([Developer Policies III.E.4.h](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content)) | Verified requirement | Keep the finding computation independent from API metadata and visibly separate YouTube content from YouTube AI Chat's analysis. Separation alone does not resolve whether the overall flow is permitted. |
| June 2026 amendment | Audited analytics developers may apply for additional derived-metric and storage permissions, including certain channel scores, content tags, sentiment analysis, and brand-suitability uses. The permission applies only after the use case is accepted through the audit process. ([additional policy](https://developers.google.com/youtube/terms/derived-metrics-policy), [revision history](https://developers.google.com/youtube/terms/revision-history)) | Verified requirement | Apply for the amendment/audit, but do not assume its examples cover factual-accuracy findings or the use of external evidence. |
| API Data retention | Most Authorized Data outside listed statistics must be deleted or refreshed after 30 days; limited Non-Authorized Data may be stored no longer than 30 days without deletion or refresh. User revocation/account deletion creates additional deletion duties. ([Developer Policies III.D.2 and III.E.4](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content)) | Verified requirement | Track provenance per field. Refresh or delete YouTube-sourced title, channel name, thumbnail, and other API Data independently of the Evidence Finding lifecycle. |
| Platform defamation | API Clients must not confuse, deceive, mislead, misrepresent, or defame anyone. ([Developer Policies III.I.11](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions)) | Verified requirement | A finding can violate the platform contract even if a creator could not ultimately prove a tort. Conservative wording and review are API-access controls, not only litigation controls. |
| Copyright | Facts and ideas are not protected, but original expression in Videos, Transcripts, and evidence sources can be. Fair use is a case-specific four-factor analysis; criticism/comment are favored purposes, not automatic immunity. ([17 U.S.C. §§102, 107](https://www.copyright.gov/title17/92chap1.html), [Copyright Office guidance](https://www.copyright.gov/fair-use/more-info.html)) | Verified requirement | Prefer paraphrased atomic claims and short, necessary excerpts. Implement a source-rights ledger and takedown process; do not rely on a word-count rule. |
| Defamation/false light | Calling output an opinion does not protect an implied, provably false factual assertion. Public-figure plaintiffs generally face an actual-malice standard, but private-figure rules and false-light claims vary by state. ([Milkovich v. Lorain Journal](https://www.law.cornell.edu/supremecourt/text/497/1), [Fellows v. National Enquirer](https://law.justia.com/cases/california/supreme-court/3d/42/234.html)) | Verified doctrine; jurisdiction-specific application | Use evidence-relative claim wording, exclude accusations about people, and operate correction/appeal review before any public report. Do not rely on an “AI-generated” disclaimer to cure a false accusation. |
| Privacy/profiling | EU personal data includes information about an identifiable person, and automated evaluation of a person's reliability is “profiling.” Processing needs a lawful basis, transparency, minimization, accuracy, and retention controls; special-category inference has stricter rules. ([GDPR Arts. 4–6, 9, 13–14](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)) | Verified requirement if GDPR applies | Do not build speaker/channel reliability profiles. Determine legal basis and notice obligations with counsel before offering the feature in the EEA. |
| AI transparency | The EU AI Act generally applies from August 2, 2026. Article 50 requires notice for direct AI interaction and disclosure for certain AI-generated public-interest text, subject to specified exceptions. ([EU AI Act Arts. 50, 113](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng)) | Verified requirement; application to a private report needs counsel | Label the report and every exported/shared version as AI-generated/AI-assisted. Decide with EU counsel whether machine-readable marking and public-interest-text duties apply. |
| AI social scoring | The EU AI Act prohibits certain AI evaluation/classification of natural or legal persons over time when the score leads to unrelated-context or unjustified/disproportionate detrimental treatment. ([EU AI Act Art. 5(1)(c)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng)) | Verified rule; future author-score application needs counsel | Do not create persistent creator reliability scores or make findings available for employment, credit, insurance, housing, law enforcement, moderation, or automated advertiser-treatment decisions. |
| Marketing claims | Advertisers need a reasonable basis before disseminating express or implied objective claims; the required substantiation depends on the claim, consequences of error, and expected expert support. ([FTC Advertising Substantiation Policy](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation)) | Verified U.S. regulator policy | Do not advertise “accurate,” “unbiased,” “trustworthy,” “checks every claim,” or a percentage accuracy until evidence supports the exact net impression. |

## 1. YouTube contract and data-use constraints

### The whole product is an API Client

The YouTube API agreement defines an API Client as a website or application that accesses or uses YouTube API Services. It incorporates the Developer Policies, YouTube guidelines, credentials, and general YouTube Terms into one agreement. It also requires compliance with law and bars deceptive, unethical, false, or misleading API use. YouTube may inspect the client, suspend access, and require deletion of API Data on termination. ([API Terms §§1–6, 24](https://developers.google.com/youtube/terms/api-services-terms-of-service))

This means a separate “Evidence” service or a third-party transcription subcontractor does not necessarily move the feature outside the API agreement. The policies also reach people acting on the developer's behalf, indirect scraping, and obtaining scraped content.

The API Client must link to the YouTube Terms, state that users agree to those Terms, maintain a prominent privacy policy that describes its collection/use/sharing, link to Google's Privacy Policy, and provide required revocation/deletion controls when Authorized Data is used. ([Developer Policies III.A and III.D](https://developers.google.com/youtube/terms/developer-policies)) Existing product documents should be audited against these requirements before the Evidence Check privacy notice is added.

### Transcript acquisition is the first hard blocker

YouTube makes a transcript visible to a human for Videos with captions, but its help page describes an interactive “Show transcript” experience; it does not grant an API or commercial-reuse license. ([YouTube Help](https://support.google.com/youtube/answer/15930243)) The official Data API routes are materially narrower:

- `captions.list` requires OAuth and returns caption-track metadata, not the caption text.
- `captions.download` requires OAuth and permission to edit the Video.
- YouTube policies prohibit undocumented API use, scraping YouTube Applications, obtaining scraped data/content, downloading or caching audiovisual content without approval, and using non-API technology to retrieve API Data or any portion of YouTube audiovisual content. ([Developer Policies III.D.7, III.E.6, III.I.14](https://developers.google.com/youtube/terms/developer-policies))

Consequently, the current transcription service contract's response labels (`manual_captions`, `auto_captions`, and `whisper`) are technical provenance, not evidence of legal provenance. Before any beta, record for every Transcript: acquisition method, supplying party, source URL, authorization basis, rights/license, provider, retrieval date, applicable terms version, and whether the supplying party may sublicense processing and display.

#### Candidate acquisition routes

| Route | Assessment |
| --- | --- |
| Creator supplies a Transcript directly and grants processing/display rights | Best launch candidate. Verify uploader/rightsholder authority and keep the grant. If the Video includes other speakers or third-party material, creator ownership may not resolve every right. |
| Creator authorizes `captions.download` for a Video they can edit | Official API path, but it creates Authorized API Data duties and still raises the derived-data question. Keep the report private to that authorizing user unless YouTube expressly approves broader display. |
| Licensed transcript provider | Potentially viable only if the provider demonstrates a non-scraping, authorized acquisition chain and grants the needed commercial processing/display rights. A warranty without verifiable provenance does not cure the Developer Policy's “obtain scraped content” prohibition. |
| Learner pastes text | Useful for internal/limited research, but the Learner may lack reproduction rights and the text may not be authentic or timed. Do not treat it as a scalable public-Video route without counsel and provenance controls. |
| Scrape YouTube's transcript UI or an undocumented timed-text endpoint | Do not use. It conflicts with the express scraping and undocumented-service rules. |
| Download/separate YouTube audio and run Whisper/ASR | Do not use without prior written YouTube approval and rights-holder clearance. The fact that the product stores only resulting text does not remove the prohibited acquisition step. |

An internal prototype should therefore use creator-contributed transcripts, separately licensed transcripts, U.S.-government/public-domain material, or a purpose-built evaluation corpus—not production transcripts whose acquisition has not passed this audit.

### External evidence plus YouTube data is unresolved, not clearly permitted

Developer Policy III.E.4.h has two relevant parts: it prohibits using API Data to create derived data/metrics, and it permits non-API information to appear beside API Data only with a clear and prominent provenance disclosure. YouTube's compliance guide gives stricter examples: do not merge/combine API Data with other data, and make the types and sources visibly distinct. ([policy](https://developers.google.com/youtube/terms/developer-policies#e.-handling-youtube-data-and-content), [guide](https://developers.google.com/youtube/terms/developer-policies-guide#only_offer_metrics_that_are_available_via_youtubes_api_services))

The Evidence Check necessarily associates a Transcript-derived claim and external sources with a particular YouTube Video. That is independent product value, but it may also be viewed as new data about a YouTube resource. The May/June 2026 amendment now permits approved audited developers to create specified analytics metrics, including content tags and certain scores, but it does not expressly list factual-accuracy verdicts or authorize mixing external evidence into an API-derived score. The amendment therefore strengthens the case for applying through the audit process; it is not self-executing permission.

The compliance submission should include a field-level data-flow diagram and ask YouTube to confirm, in writing:

1. whether a claim-level `Supported / Qualified / Contradicted / Unresolved` Evidence Finding is “derived data or metrics”;
2. whether it matters that the finding is computed without API title, description, channel name, view counts, comments, categories, or engagement data;
3. whether a lawfully obtained non-API Transcript plus external evidence may be associated with a Video ID and shown beside an embedded player;
4. whether the June 2026 analytics amendment applies and, if so, which storage and display conditions govern;
5. the exact disclosure and visual separation YouTube expects; and
6. whether the approved use may cover ordinary Learners or only content owners/authorized representatives.

Until answered, display prototypes should use a prominent notice such as: **“Evidence Findings are generated by YouTube AI Chat from the displayed Transcript and external sources. They are not provided, reviewed, or endorsed by YouTube.”** Label YouTube-origin metadata separately from Transcript provenance and external evidence. Do not use YouTube API statistics, comments, channel data, categories, or metadata as inputs to claim selection, verdicts, confidence, eligibility, or ranking.

YouTube's separate prohibition on confusing, misleading, misrepresenting, or defaming anyone makes output quality a direct API-contract issue. A cautious label, correction flow, or successful legal defense would not necessarily prevent YouTube from treating a harmful output as noncompliance. ([Developer Policies III.I.11](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions))

### Retention, branding, playback, and monetization

Evidence Findings need their own lifecycle, but API Data inside a report remains subject to YouTube refresh/deletion duties. Preserve field-level provenance rather than copying the Video title/channel/thumbnail into an immutable report snapshot. Recheck Video availability and public status; on deletion or privacy change, stop display and apply the retention rule confirmed by YouTube. Authorized caption data must be removed on revocation under the applicable deadlines. ([Developer Policies III.D.2, III.E.4](https://developers.google.com/youtube/terms/developer-policies))

Pages displaying YouTube content must attribute YouTube as the source of that content, while non-YouTube material must not look as if it originated from YouTube. The embedded player cannot be obscured or modified, and audio/video cannot be separated. ([Developer Policies III.F](https://developers.google.com/youtube/terms/developer-policies#f.-user-experience), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality))

YouTube permits selling an API Client, but third-party ads on a page containing API Data require enough non-YouTube independent value to justify the ad sale even without the API Data; ads cannot be placed in or on the player without approval. ([Developer Policies III.G](https://developers.google.com/youtube/terms/developer-policies#g.-distribution-and-commercial-use)) The beta should nonetheless contain no sponsored Evidence Findings, paid source placement, or ads targeted from a verdict. Those practices would complicate independence, privacy, and the net impression of the report. Paid product access is safer to assess than report-level sponsorship, but YouTube should confirm the precise UI.

## 2. Defamation, false light, and editorial framing

### Why claim-level output still creates publication risk

A generated finding is the product's own editorial output. Section 230 protects against treating a service as publisher of information “provided by another information content provider,” while defining an information content provider as an entity responsible in whole or part for creating or developing the information. It is therefore unsafe to assume Section 230 immunizes an Evidence Finding the product creates. ([47 U.S.C. §230(c), (f)(3)](https://www.law.cornell.edu/uscode/text/47/230))

Under U.S. constitutional doctrine, merely saying “in our opinion” does not protect a statement that reasonably implies provably false facts. Public officials/figures generally must prove knowing falsity or reckless disregard, but private-person standards can be lower and state tort elements vary. False light can reach a highly offensive false impression even when wording is not a conventional direct accusation; some states recognize it and others do not. The global risk is wider because U.S. First Amendment rules do not govern every publication jurisdiction. ([Milkovich](https://www.law.cornell.edu/supremecourt/text/497/1), [Fellows](https://law.justia.com/cases/california/supreme-court/3d/42/234.html), [UK Defamation Act 2013](https://www.legislation.gov.uk/ukpga/2013/26/contents))

Errors especially capable of producing reputational harm include: assigning another speaker's words to the creator; dropping a negation; converting satire, quotation, prediction, or opinion into a factual assertion; ignoring the Video's surrounding qualification; using evidence from the wrong time or jurisdiction; and equating lack of retrieved support with falsity.

### Required editorial posture

The beta should describe an evidence relationship, not pronounce truth, character, or intent:

- Prefer **“The sources retrieved as of [date] support / qualify / conflict with / do not resolve this claim”** over “true,” “false,” “right,” “wrong,” “lie,” or “misinformation.”
- Never infer knowledge, motive, honesty, legitimacy, bias, or deceptiveness.
- Preserve the original timestamped wording and enough adjacent context for a Learner to audit the normalized claim.
- Identify the speaker only when the Transcript and Video make attribution reliable. “The Video states” is safer than naming an author, but must not conceal multi-speaker ambiguity.
- Treat `Unresolved` as lack of sufficient evidence, not evidence that the claim is false.
- Show evidence on both sides, relevant dates/jurisdiction, the retrieval cutoff, Transcript source/quality, and limitations.
- Do not aggregate findings across Videos, create creator/channel histories, rank people, or expose a report through public search/indexing in the beta.

Add automatic ineligibility for claims that accuse an identifiable person or small business of crime, fraud, dishonesty, professional incompetence/malpractice, sexual misconduct, abuse, or other serious wrongdoing; claims about a private individual or minor; and claims whose speaker identity is uncertain. These exclusions supplement #381's medical, legal, finance, election, breaking-news, and public-safety exclusions.

A correction and appeal process is a launch requirement, not a later enhancement. It should accept reports from the speaker/creator, subject, source publisher, and Learner; immediately suppress a plausibly harmful finding pending review; retain an internal audit trail; publish a visible corrected version and date; and notify affected viewers when feasible. Counsel should set response times, preservation rules, retraction language, and whether corrections reduce damages in each launch jurisdiction. Disclaimers and appeals reduce risk but are not immunity.

## 3. Copyright, fair use, and evidence-source rights

Copyright protects original literary and audiovisual expression, not the underlying fact, idea, method, or discovery. A verbatim Transcript or evidence passage can reproduce protected expression even when the proposition it communicates is a fact. Section 107 lists criticism, comment, scholarship, and research as possible fair-use purposes, but courts balance purpose/character, nature of the work, amount/substantiality, and market effect. Commercial use is relevant, and there is no fixed safe number of words or percentage. ([17 U.S.C. §§102, 106–107](https://www.copyright.gov/title17/92chap1.html), [Copyright Office fair-use guidance](https://www.copyright.gov/fair-use/more-info.html))

Evidence Check's critical/commentary purpose, timestamp links, and non-substitutive short excerpts can support a U.S. fair-use position. Against that, the app is commercial, may create and retain full-text copies during retrieval, and could substitute for visiting a source or reading a Transcript. Fair use also does not override YouTube's contractual scraping/download restrictions.

### Conservative source-use policy

1. Store the factual proposition as a paraphrase wherever exact wording is unnecessary.
2. Display only the shortest source and Transcript excerpt necessary to let a Learner verify the relationship; never use a fixed “under N words is safe” rule.
3. Link to the canonical source, name the publisher/author, show publication and retrieval dates, and never bypass a paywall, authentication, technical control, or robots/TDM reservation.
4. Maintain a source-rights ledger: URL/domain, acquisition method, terms/license, permitted purpose, quote/display limit, retention rule, robots/TDM signal, territory, attribution, and takedown contact.
5. Prefer sources with explicit reuse rights and stable provenance: original public records, open-licensed research/data, and U.S. federal-government works. Verify authorship because the U.S. government may hold third-party copyrighted material even though works prepared by federal employees as part of official duties are generally not protected under Title 17. ([17 U.S.C. §105](https://www.copyright.gov/title17/92chap1.html#105))
6. Do not persist full fetched pages by default. Store citation metadata, a minimal evidence span where justified, retrieval/hash information, and the license basis. If reproducibility requires a snapshot, restrict it internally and set a rights-based retention period.
7. Contractually require retrieval/search/model vendors not to reuse report inputs for model training unless separately approved, and obtain warranties/indemnities appropriate to the source path.
8. Implement copyright and source-correction notices with prompt disablement/review. If the product accepts user-uploaded sources, counsel should separately evaluate DMCA agent/notice-and-takedown eligibility and procedures.

Outside the United States, exceptions differ. The EU's commercial text-and-data-mining exception requires lawful access and is unavailable when a rights holder appropriately reserves TDM rights, including through machine-readable means for online content. EU press-publisher and database rights may also apply. ([Directive (EU) 2019/790 Arts. 4, 15](https://eur-lex.europa.eu/eli/dir/2019/790/oj/eng)) The UK's quotation/fair-dealing and TDM rules are not identical to U.S. fair use. ([Copyright, Designs and Patents Act 1988 §§29A, 30](https://www.legislation.gov.uk/ukpga/1988/48/contents)) Do not assume a U.S. source policy clears global use.

## 4. Privacy, profiling, and identifiable speakers

The no-author-score decision is important for privacy as well as defamation. A single claim card may still process personal data when it identifies a speaker or evaluates a claim about a person. A persistent author/channel “accuracy history” would more clearly evaluate reliability and become profiling under both GDPR and California's statutory definition. ([GDPR Art. 4](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), [California Civil Code §1798.140](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140.))

Public availability is not a universal exemption. GDPR applies to information relating to an identifiable person and requires a lawful basis, fairness/transparency, purpose limitation, minimization, accuracy, storage limitation, and security. If data is obtained from a Video rather than the person, Article 14 notice and its exceptions need analysis. Inferences revealing political views, religion, health, sexual orientation, or other special categories trigger Article 9 unless an exception applies; “manifestly made public by the data subject” is fact-specific and may fail when a channel uploader and speaker differ. ([GDPR Arts. 5–6, 9, 14](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng))

Before any EEA launch, counsel should document the controller/processor roles, Article 6 basis (including any legitimate-interests assessment), Article 14 approach, data-subject request workflow, international transfers, processor agreements, retention, and whether a DPIA is required. A U.S.-only Learner beta can reduce but not automatically eliminate foreign-speaker, foreign-publication, or conflict-of-laws exposure.

For the beta:

- require a public Video and keep the report learner-private, non-indexed, and non-shareable;
- store no face/voice embeddings, demographic inference, political/religious/health inference, or cross-Video speaker identity;
- key reports to a Video and Transcript version, not a person/channel reputation record;
- do not train models on report requests, Transcripts, or appeals without a separate documented legal basis and notice;
- publish specific retention and deletion periods, including deletion propagation to vendors;
- provide creator/subject access, correction, objection, and deletion intake even where not strictly required; and
- exclude made-for-kids Videos and minors from the beta pending child-privacy review.

If EEA Learners can access the product, the EU AI Act now generally applies. The UI should clearly say when a finding and explanation are AI-generated or AI-assisted, and exports should preserve that disclosure. Article 50's machine-readable marking and public-interest-text rules need a provider/deployer and private/public-output analysis with EU counsel. ([EU AI Act Arts. 2, 50, 113](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng))

The same Act's prohibited social-scoring rule is another reason not to revive an author/channel trust score. A Video-specific evidence report is not automatically social scoring, but a persistent creator rating used to impose unrelated or disproportionate unfavorable treatment could move toward Article 5's prohibited fact pattern. Keep the beta out of employment, credit, insurance, housing, law-enforcement, platform-enforcement, and automated advertiser-vetting decisions, and obtain EU counsel before any downstream scoring use. ([EU AI Act Art. 5(1)(c)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng))

## 5. Advertising and product-promise substantiation

The FTC treats an objective product claim as carrying an implied representation that the advertiser has a reasonable basis for it before dissemination. If an ad claims a specified level of proof—“tests prove,” “95% accurate,” “expert verified”—the advertiser needs at least that level of substantiation. The net impression and reasonable implied claims matter, not only literal wording. ([FTC Advertising Substantiation Policy](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation))

Until the evaluation ticket establishes representative evidence, market only the workflow:

> “Evidence Check compares selected, transcript-verifiable claims with cited external sources and shows what the retrieved evidence supports, qualifies, conflicts with, or cannot resolve.”

Do not market it as a “fact checker,” “truth detector,” “trust score,” “legitimacy score,” “unbiased rating,” or a check of all claims. Do not advertise benchmark accuracy without defining the eligible domain, claim unit, human-review policy, evidence requirement, sample construction, confidence interval, model/version, and abstention coverage. A result that is correct only among the easiest resolved claims cannot be advertised as overall Video accuracy.

Marketing and UI must not suggest YouTube sponsorship, review, or endorsement; the API Terms expressly prohibit that without YouTube's prior review and written approval. ([API Terms §13](https://developers.google.com/youtube/terms/api-services-terms-of-service))

## 6. Required beta specification changes

Add these requirements to the implementation-ready specification:

### Eligibility

- Public English Videos only, with a rights-cleared, reliably timed Transcript.
- Exclude private/unlisted, made-for-kids, minors, predominantly visual content, satire/parody, uncertain speaker attribution, accusations about identifiable people, and all high-risk categories already listed in #381.
- Run deterministic eligibility before external retrieval. Ineligible reports should state a neutral reason and create no finding.

### Data and provenance boundary

- Record separately: learner-supplied Video reference; YouTube API Data; Transcript text/source/right basis; external source content/license; and YouTube AI Chat-generated Evidence Findings.
- Use no YouTube API metadata/statistics/comments as model inputs to the Evidence Finding.
- Put the non-YouTube/AI disclosure next to the report, not only in Terms or a tooltip.
- Apply API refresh/deletion separately from report expiry and evidence re-checking.

### Finding language and presentation

- Use `Supported by retrieved evidence`, `Qualified by retrieved evidence`, `Conflicts with retrieved evidence`, and `Unresolved` as evidence-relative labels; validate the final labels with counsel and comprehension testing.
- Put original context, cited evidence, dates, limitations, and Transcript confidence before any color treatment.
- Never describe the speaker/channel as right, wrong, trustworthy, legitimate, biased, deceptive, or dishonest.
- No numeric score, channel aggregation, public report URL, social sharing, search indexing, or automated recommendation/moderation effect.

### Operations

- Version findings rather than silently overwriting them; display analysis and correction dates.
- Maintain a staffed correction/appeal/takedown queue with escalation for reputational claims.
- Sample reports for human review and retain an auditable record of retrieved evidence, prompt/model/retriever versions, and reviewer actions consistent with source rights.
- Add an immediate kill switch and suppress affected reports when transcript provenance, a source license, or a verdict is challenged.
- Re-review YouTube terms and the source-rights registry before each expansion in topic, language, geography, sharing, monetization, or score behavior.

## 7. Approval packet and unresolved questions

### Submit to YouTube

- Field-level architecture/data-flow diagram, screenshots, disclosures, exact Transcript routes, storage periods, vendors, and deletion paths.
- Statement that the beta does not use engagement data, assess brand safety, rate channels/people, moderate Videos, or imply YouTube endorsement.
- Exact question whether external-evidence claim findings require the June 2026 derived-metrics amendment and whether associating them with a Video ID is permitted.
- Request approval for any audiovisual acquisition/transcription path; do not treat a quota extension or generic audit pass as that written approval unless it expressly covers the path.

### Resolve with counsel

1. Launching entity, governing user terms, target states/countries, and geofencing.
2. Transcript and source acquisition rights, fair-use/fair-dealing analysis, publisher/database rights, vendor contracts, and DMCA process.
3. Defamation/false-light standards, high-risk exclusions, correction/retraction process, anti-SLAPP/retraction statutes, insurance, and pre-publication review triggers.
4. Privacy legal bases/notices, speaker/creator rights requests, CCPA applicability, GDPR/UK GDPR, transfers, retention, DPIA, and child exclusions.
5. EU AI Act provider/deployer classification and Article 50 implementation if the EEA is in scope.
6. Exact product and marketing language, benchmark substantiation, sponsorship/advertising policy, and whether users may export/share a report later.

## Go/no-go rule

**Go to an internal evaluation build now** using a rights-cleared corpus and no production YouTube scraping/audio extraction. **Go to a private Learner beta only after** the transcript gate, written YouTube gate, and legal/editorial gate are all complete and implemented in the specification. If YouTube will not approve the external-evidence association or no scalable lawful Transcript route exists, stop the YouTube-linked feature and pivot to creator-supplied/licensed media or a standalone user-provided-document evidence checker.

The safest valuable product remains the one already chosen in #381: an evidence ledger about a bounded set of claims, with visible provenance and abstention—not a judgment about an author and not a legitimacy/trustworthiness score.
