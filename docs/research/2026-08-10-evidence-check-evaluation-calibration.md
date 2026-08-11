# Evidence Check evaluation and calibration options

Research date: 2026-08-10
Decision ticket: [#387](https://github.com/xtan9/youtubeai_chat_frontend/issues/387)

## Decision summary

No public benchmark, aggregate accuracy number, or LLM-as-judge score is sufficient to clear a YouTube Transcript Evidence Check for launch. The defensible evaluation is a layered scorecard with two distinct uses:

1. Public benchmarks test whether individual components and the end-to-end pipeline are competitive on known research tasks.
2. A frozen, human-adjudicated product gold set determines whether the actual experience is safe and useful on eligible Videos, production Transcripts, live web evidence, and the proposed interface.

AVeriTeC is the closest public end-to-end analogue because it uses real-world claims, open-web evidence, four verdicts, annotated question-answer evidence, justifications, and time-constrained retrieval. Its conditional score only credits a correct verdict after evidence similarity clears a threshold. It should be adopted as a regression benchmark, but not copied as the product's quality score: the 2024 shared-task organizers found near-zero correlation between its Hungarian-METEOR evidence score and human ratings of evidence coverage, coherence, consistency, relevance, and repetition ([Schlichtkrull et al., 2024](https://aclanthology.org/2024.fever-1.1/)).

The later human-in-the-loop (HITL) decision should therefore set separate gates for:

- material-claim coverage and normalization faithfulness;
- evidence retrieval, source validity, citation entailment, and citation completeness;
- verdict quality by class, including high-confidence errors;
- calibration and the risk-versus-coverage trade-off;
- correct abstention and ineligible-Video handling;
- temporal integrity and freshness;
- resilience to Transcript errors, evidence poisoning, and indirect prompt injection; and
- Learner comprehension and overreliance.

The most important launch statistic is not overall accuracy. It is the upper confidence bound on **silent consequential error**: a materially wrong, non-abstained verdict shown with enough confidence to invite reliance. Coverage must be reported beside that risk so the system cannot appear safe merely by refusing most claims.

## What the public benchmarks establish

| Resource | What it evaluates | What it can establish here | What it cannot establish here |
| --- | --- | --- | --- |
| [FEVER](https://aclanthology.org/N18-1074/) and the [FEVER shared-task scorer](https://fever.ai/2018/task.html) | 185,445 human-generated claims derived from a fixed 2017 Wikipedia snapshot; labels are Supports, Refutes, and Not Enough Info. The strict FEVER score gives credit only for a correct label plus at least one complete annotated evidence set (except NEI). | A stable component regression for document retrieval, sentence retrieval, natural-language inference, and strict label-plus-evidence scoring. It also demonstrates why label accuracy must be reported separately from end-to-end evidence-grounded correctness. | Natural claims spoken in Videos; open-web source quality; claim selection from a long Transcript; current or time-sensitive evidence; partial/mixed claims; citation links; abstention calibration; report UX. The claims are intentionally constructed from Wikipedia rather than sampled from real media. |
| [AVeriTeC dataset](https://proceedings.neurips.cc/paper_files/paper/2023/hash/cd86a30526cd1aff61d6f89f107634e4-Abstract-Datasets_and_Benchmarks.html) | 4,568 real-world claims from 50 fact-checking organizations, annotated with evidence-backed question-answer pairs, justifications, and Supported, Refuted, Not Enough Evidence, or Conflicting Evidence/Cherrypicking verdicts. Its multi-round process reports verdict agreement of κ=0.619 and was designed to limit context dependence, insufficient evidence, and evidence published after the claim. | The closest public test of open-domain, multi-query evidence retrieval and verdict synthesis. The four-way label space is more realistic than FEVER for mixed evidence. A chronologically constrained knowledge store makes results reproducible. | Claim extraction from a Transcript, importance ranking, ASR errors, timestamp attribution, production web search, source-authority rules, user comprehension, or calibrated abstention. Claims were already selected by professional fact-checkers, so it bypasses a major product failure mode: omitting a Video's important claims. |
| [AVeriTeC 2024 shared task](https://aclanthology.org/2024.fever-1.1/) | Hungarian matching maximizes METEOR similarity between up to ten predicted and gold question-answer pairs. The AVeriTeC score counts verdict accuracy only when question-answer evidence similarity is at least 0.25. The winning score was 0.63. | A reproducible end-to-end regression and a useful precedent for refusing to credit a correct-looking verdict without evidence. Its per-document-type and evidence-count slices can expose retrieval weaknesses. | A launch threshold. Lexical similarity is not evidence truth, sufficiency, authority, independence, or correct citation attachment. The organizers' human study found correlations from roughly -0.024 to 0.117 between Hungarian METEOR and five evidence-quality dimensions, explicitly motivating better human-aligned measures. The 0.25 cutoff is a competition setting, not a safety guarantee. |
| [Factcheck-Bench](https://aclanthology.org/2024.findings-emnlp.830/) | An eight-stage framework for decomposition, decontextualization, check-worthiness, retrieval, evidence stance, correction need, claim correction, and final revision, with claim-, sentence-, and document-level annotations. | A strong template for instrumenting and scoring each Evidence Check stage instead of treating the pipeline as a black box. It explicitly labels factual claims, opinions, non-claims, importance, partial support, and insufficient evidence. | Direct transfer to Videos. Its source material is LLM-generated responses selected to be fact-intensive and error-prone, not spoken Transcripts. The paper also notes that assisted annotation may bias annotations toward the automatic decomposition shown to raters. |
| [CheckThat! 2024](https://checkthat.gitlab.io/clef2024/pdf/CLEF_2024_CheckThat_LNCS_draft.pdf) and [CheckThat! 2025 claim normalization](https://arxiv.org/abs/2503.14828) | Check-worthiness of statements from tweets, transcripts, and political debates; subjectivity; and normalization of noisy social-media claims. | External tests for separating checkable facts from opinions/non-claims, ranking claims for limited review capacity, and cleaning noisy language before retrieval. These tasks reinforce that checkability and importance are separate judgments. | Product completeness. Political and social-media distributions differ from long educational Videos, and benchmark annotations do not define which 8–15 claims best represent an entire Video. Normalization scores do not guarantee that the normalized claim preserved the speaker's qualifiers, time frame, or intended scope. |
| [FActScore](https://aclanthology.org/2023.emnlp-main.741/) | Decomposes long-form generations into atomic facts and measures the percentage supported by a chosen knowledge source. | A useful atomicity and claim-level factual-precision baseline; it shows why one binary document verdict hides mixtures of supported and unsupported facts. | Materiality, open-web source quality, contradictory evidence, author intent, transcript fidelity, or claim recall. It was validated primarily on generated biographies against a selected knowledge source, and factual precision can be inflated by checking easy claims while omitting important ones. |
| [Decomposition Dilemmas](https://aclanthology.org/2025.naacl-long.320/) | Measures downstream effects and error types introduced by decompose-then-verify systems. | Evidence that decomposition must itself be evaluated for semantic preservation and not assumed to improve verification. | A universal best atomicity policy. The study finds a trade-off: decomposition can improve verification or add noise depending on the input and verifier. |
| [ALCE](https://aclanthology.org/2023.emnlp-main.398/) | End-to-end retrieval and cited answer generation, with automatic and human evaluation of answer correctness, citation recall/completeness, and citation precision/entailment. | A practical model for scoring whether every displayed factual assertion has support and whether every citation actually supports the assertion it is attached to. | Whether the evidence itself is authoritative, current, independent, or sufficient for a fact-checking verdict. ALCE's tasks are information-seeking QA, not adversarial claim verification, and automated entailment graders still require validation on the product gold set. |
| [TSVer](https://aclanthology.org/2025.emnlp-main.1519/) | 304 real-world claims grounded in 400 curated time series, with annotated time frames, verdicts, and evidence-use justifications. It reports κ=0.77 on verdicts; a strong reasoning model reached 63.57% verdict accuracy and 48.63 on its evidence-to-verdict rationale measure. | A targeted challenge set for numerical trends, comparisons, windows, and time-series claims that ordinary text retrieval often mishandles. | General web verification, claim selection, or source quality. Its curated structured evidence is much cleaner than figures and statistics mentioned in Videos. |
| [AVerImaTeC](https://arxiv.org/abs/2505.17978) | Real-world image-text claims with web evidence, claim normalization, temporal constraints, and two-stage evidence sufficiency checks. | A future benchmark for a multimodal Evidence Check and a reminder that Transcript-only evaluation cannot cover claims whose meaning or evidence is visual. | Text-only beta readiness. Passing AVerImaTeC would not repair missing frames, charts, demonstrations, or on-screen qualifiers in the current product input. |

### Recommended use of public benchmarks

Run FEVER, AVeriTeC, Factcheck-Bench subtasks, ALCE-style citation metrics, and a small TSVer slice as repeatable engineering regressions. Report their native metrics without combining them. Do not average them into a “trustworthiness” score and do not compare a product score with an AVeriTeC leaderboard percentage.

The product's frozen gold set remains the launch authority because it alone can jointly represent Video selection, production Transcript quality, timestamp context, the live source policy, abstention, and the Learner-facing report.

## Product evaluation model

### 1. Claim discovery, selection, and normalization

The evaluation unit must begin with the whole Video, not with preselected claims. Otherwise a pipeline can achieve high precision by selecting only obvious truths and silently omitting the central disputed statement.

For each Video, human reviewers should independently annotate:

- every material checkable claim span and Timestamp Citation;
- speaker and whether the words are the speaker's own assertion, a quotation, a hypothetical, satire, or reported speech;
- checkability category: factual, opinion/value judgment, prediction, advice, non-claim, or unverifiable from admissible evidence;
- importance: central, consequential supporting claim, or incidental;
- a context-complete normalized claim that retains entities, quantities, units, negation, modality, qualifiers, geography, and time frame; and
- permissible grouping when several atomic facts must be evaluated together to preserve meaning.

Score at least:

- **material-claim recall**: weighted recall of gold central and consequential claims among selected claims;
- **selection precision**: proportion of selected items that are genuinely checkable claims;
- **span/timestamp quality**: overlap with the gold Transcript Passage and timestamp deviation;
- **normalization faithfulness**: human pass rate for “same assertion, no lost qualifier, no added fact”;
- **atomicity/decontextualization pass rate**: independently checkable without inventing context;
- **speaker-attribution accuracy**; and
- **duplicate rate and claim-budget utilization**.

CheckThat! can seed check-worthiness models, FActScore can seed atomic extraction, and Factcheck-Bench can seed the annotation schema. None supplies the essential Video-level recall denominator. A later HITL ticket should decide whether central claims carry more weight, but should always publish unweighted counts beside a weighted measure.

### 2. Retrieval and evidence quality

Maintain more than one valid gold evidence set where different sources can independently establish the claim. FEVER's requirement for one complete sufficient set is a useful strict pattern, while AVeriTeC's question-answer representation is useful for multi-hop claims. The gold record should distinguish:

- a source document being relevant;
- the cited passage entailing, contradicting, qualifying, or not addressing the claim;
- the collected evidence being jointly sufficient for a verdict;
- source authority and directness for the subject;
- source independence rather than duplicated syndication;
- publication time, the time period the evidence describes, and retrieval time; and
- whether contrary admissible evidence exists.

Report:

- document and passage Recall@k against any acceptable sufficient evidence set;
- evidence precision and stance macro-F1;
- **citation correctness**: proportion of attached citations that actually support the adjacent system assertion;
- **citation completeness**: proportion of externally checkable system assertions with sufficient citation support;
- **sufficiency pass rate** for the complete evidence bundle;
- source URL resolution and exact-passage reproducibility;
- source-policy compliance, authority, independence, and freshness pass rates; and
- contrary-evidence retrieval recall on claims whose gold record includes conflict.

ALCE's citation precision and recall provide implementable automatic proxies, but human review must remain the gold standard. An entailment model can accept a citation that merely repeats the claim, misses a qualifier, or comes from a low-quality circular source. Conversely, reference-string matching can penalize a valid evidence path that differs from the annotator's. AVeriTeC's own human comparison is direct evidence of this limitation ([Schlichtkrull et al., 2024](https://aclanthology.org/2024.fever-1.1/)).

### 3. Verdict and end-to-end correctness

Evaluate the actual product label set, not a forced binary “right/wrong” reduction. At minimum, the gold schema should preserve Supported, Mostly supported, Mixed/missing context, Contradicted, Unresolved, and Not fact-checkable if those are the eventual interface labels. Reviewers should be allowed to mark genuinely ambiguous cases for adjudication rather than inventing certainty.

Report:

- confusion matrix, macro-F1, and per-class precision/recall;
- class-balanced accuracy in addition to ordinary accuracy;
- precision for negative/accusatory labels such as Contradicted and Mixed;
- severity-weighted error, where a high-confidence reversed verdict on a central claim costs more than an adjacent-label error on an incidental claim;
- end-to-end strict correctness: faithful claim + valid timestamp/speaker + sufficient evidence + correct verdict + no policy or temporal violation;
- report-level material-claim coverage; and
- results both per claim and clustered per Video, with confidence intervals bootstrapped at the Video level.

FEVER and AVeriTeC establish the value of conditional end-to-end scoring, but their exact score definitions should not be the product metric. Keep diagnostic metrics separate so a retrieval regression cannot be hidden by a verdict aggregate.

### 4. Confidence calibration and selective prediction

Confidence must be an empirically calibrated estimate of correctness on the product distribution, not the model's unvalidated verbal self-rating. Black-box LLM confidence methods remain overconfident and no elicitation method works consistently across hard tasks ([Xiong et al., ICLR 2024](https://proceedings.iclr.cc/paper_files/paper/2024/hash/6733cf15e10e2cd1d59af033c3bb8507-Abstract-Conference.html)); verbalized uncertainty is also unreliable for explanation confidence ([Tanneru et al., AISTATS 2024](https://proceedings.mlr.press/v238/harsha-tanneru24a.html)).

Use a held-out calibration split and version calibration with the complete pipeline: model, prompt, retriever, source rules, and Transcript source. Temperature scaling is a reasonable simple baseline, but it must be refit and re-evaluated after relevant pipeline changes; its original evidence is classification-specific and does not guarantee transfer to this task ([Guo et al., 2017](https://arxiv.org/abs/1706.04599)).

For each issued verdict, retain a probability of end-to-end strict correctness. Report:

- multiclass Brier score and negative log loss, both strictly proper scoring rules that reward honest probability estimates ([Gneiting and Raftery, 2007](https://doi.org/10.1198/016214506000001437));
- reliability diagrams and calibration error overall and by verdict, importance, topic, evidence source, Transcript source, and time slice;
- failure-detection AUROC/AUPRC for the confidence ranking;
- coverage, the proportion of eligible claims receiving a verdict;
- selective risk, the error rate among non-abstained verdicts, at each candidate threshold;
- risk at fixed operational coverage and coverage at a maximum acceptable risk;
- the full risk-coverage curve; and
- AURC for comparability plus AUGRC as a complementary multi-threshold measure.

Do not use ECE alone. ECE depends on binning and has known estimation bias and continuity limitations ([Futami and Fujisawa, NeurIPS 2024](https://papers.nips.cc/paper_files/paper/2024/hash/9961e42624a6c083279303767c73269d-Abstract-Conference.html); [Chidambaram et al., ICML 2024](https://proceedings.mlr.press/v235/chidambaram24a.html)). Likewise, AURC is common but can behave counterintuitively because it aggregates conditional selective risk; AUGRC was proposed to measure the joint rate of accepted failures across thresholds ([Traub et al., NeurIPS 2024](https://papers.nips.cc/paper_files/paper/2024/file/047c84ec50bd8ea29349b996fc64af4b-Paper-Conference.pdf)). At launch, a fixed operating point and its confidence interval matter more than any area summary.

### 5. Abstention

Treat abstention as a first-class output with a reason, not as a hidden failure or a generic “low confidence” label. Gold reasons should distinguish:

- not a factual/checkable claim;
- insufficient or conflicting admissible evidence;
- unreliable Transcript or speaker attribution;
- missing visual context;
- time ambiguity or evidence that cannot establish the relevant historical state;
- out-of-scope or high-risk topic; and
- infrastructure/retrieval failure.

Score correct-abstention recall for each reason, unnecessary-abstention rate on resolvable claims, false-verdict rate on claims that should have been abstained, and Video-level refusal correctness. Plot these beside coverage. Selective-prediction research formalizes the core trade-off: rejecting uncertain inputs can reduce risk only by reducing coverage ([Geifman and El-Yaniv, ICML 2019](https://proceedings.mlr.press/v97/geifman19a)).

An aggregate “accuracy among answered claims” is unsafe on its own because the pipeline can improve it by abstaining selectively on difficult verdict classes or topics. The HITL decision should therefore require class- and slice-specific minimum coverage as well as maximum selective risk.

## Temporal robustness

Fact-checking has three different times that must not be collapsed:

1. **claim time**: when the statement was made in the Video;
2. **valid time**: the period the statement describes or during which a fact held; and
3. **evidence/retrieval time**: when a source was published and when the Evidence Check accessed it.

AVeriTeC constrains its knowledge store to documents available before the claim, specifically to avoid post-claim fact-check articles leaking the verdict ([Schlichtkrull et al., 2023](https://proceedings.neurips.cc/paper_files/paper/2023/hash/cd86a30526cd1aff61d6f89f107634e4-Abstract-Datasets_and_Benchmarks.html)). This is a valuable benchmark control, not necessarily the only product rule. A later source-policy decision may allow later primary evidence to establish what was true at claim time, but must distinguish “correct when said” from “current status” and must never present hindsight as evidence the speaker had available.

Time-aware evidence ranking has improved verification of time-sensitive claims compared with relevance-only ranking ([Allein, Augenstein, and Moens, 2021](https://arxiv.org/abs/2009.06402)), while recent robustness testing finds that LLMs remain sensitive to temporal reformulation and time-reference granularity ([Wallat et al., 2025](https://aclanthology.org/2025.findings-acl.810/)). Product evaluation should therefore include:

- chronological train/calibration/test splits by Video publication date, with the newest period untouched until final evaluation;
- frozen search-result manifests or archived source snapshots so a run can be reproduced;
- automatic and human checks for evidence published outside the allowed window;
- paired claims whose only change is year, relative date, tense, or time granularity;
- facts that changed after the Video, including office holders, prices, records, totals, recommendations, and scientific consensus;
- 30- and 90-day reruns to measure verdict, citation, and calibration drift as the web changes; and
- explicit source disappearance, correction, and updated-page cases.

Report performance by Video age and evidence age. A random split is not enough: it lets near-duplicate events and later evidence appear on both sides of evaluation.

## Adversarial retrieval and prompt injection

The Transcript and every retrieved page are untrusted content. Test instructions spoken in a Video or embedded in a page—such as “ignore previous instructions,” forged system messages, hidden text, or instructions to alter a verdict—as data that must never control the verifier.

Two public attack families are directly relevant:

- BIPIA is a benchmark for indirect prompt injection placed in external content ([Yi et al., 2023](https://arxiv.org/abs/2312.14197)). InjecAgent extends indirect-injection testing to tool-integrated agents ([Zhan et al., Findings of ACL 2024](https://aclanthology.org/2024.findings-acl.624/)).
- PoisonedRAG shows that a small number of malicious texts injected into a large retrieval collection can steer target answers; its reported attack reached 90% success after five injected texts per target question, and evaluated defenses were insufficient ([Zou et al., USENIX Security 2025](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)).

Neither benchmark reproduces live YouTube Evidence Check conditions, so build a custom red-team suite containing:

- direct and obfuscated instructions in the Transcript;
- indirect instructions in visible page text, metadata, alt text, comments, tables, and Unicode/hidden-text variants;
- SEO keyword stuffing and pages that repeat the target claim without independent evidence;
- duplicated or syndicated misinformation across nominally different URLs;
- a poisoned document placed above correct primary sources;
- contradictory primary and secondary sources;
- fake citations, broken citations, citation loops, and sources citing one another;
- query manipulation via adversarial names, quotes, URLs, and markup; and
- evidence that is topically relevant but has the wrong person, jurisdiction, unit, or time period.

Measure attack success as any instruction-policy violation, verdict flip, false high-confidence verdict, poisoned citation selection, or leakage of system data. Also measure clean utility: defenses that reject all external evidence are not useful. Report results by attacker access, number and rank of poisoned documents, source type, model/retriever version, and whether corroboration rules were active.

A reasonable blocking invariant is zero observed control-flow compliance with retrieved instructions in the fixed adversarial suite. Statistical verdict-risk gates should still use confidence bounds because zero observations do not imply zero population risk.

## Human-reviewed product gold set

### Sampling unit and strata

Sample complete Videos first, then annotate claims. A claim-only sample cannot measure omitted central claims or report-level cherry-picking. Restrict the core beta gold set to the agreed English, reliable-timed-Transcript, low-risk, source-rich eligibility envelope, but deliberately include boundary cases that should be refused.

Stratify at least by:

- topic and expected source type;
- Video length and number of speakers;
- claim density and proportion of opinion/prediction;
- source-caption versus automatic-caption versus product ASR Transcript;
- clean versus noisy audio, accent/dialect, speech rate, overlap, and technical vocabulary;
- Video age and claim temporal sensitivity;
- verdict class, evidence conflict, single-hop versus multi-hop, and numerical reasoning;
- eligible, borderline, and clearly ineligible Videos; and
- ordinary, adversarial, and known-regression cases.

Keep a separate challenge set enriched for rare failures. Do not mix challenge-set prevalence into the headline product estimate; report it as worst-case diagnostic performance.

### Annotation protocol

Use trained reviewers who can inspect the Video/audio, the production Transcript, the normalized claim, full source pages, publication metadata, and archived passages. For each gold item, store the decision plus the audit trail rather than only a label.

Recommended protocol:

1. Pilot the guidelines on a diverse set, discuss disagreements, revise definitions, and freeze a version before benchmark annotation.
2. Have two reviewers independently annotate claim selection/importance, normalization, evidence stance/sufficiency, verdict, confidence/ambiguity, and abstention reason. Keep them blind to the system result during primary annotation.
3. Use a third trained adjudicator for disagreement. Use subject-matter experts when the evidence cannot responsibly be interpreted by general reviewers; such cases may instead validate that the beta abstains.
4. Preserve pre-adjudication labels and reasons. Consensus alone hides ambiguity.
5. Separate development, calibration, and final test Videos. Do not use final-test disagreements, sources, or system outputs to tune prompts or thresholds.
6. Version claims, source snapshots, annotation guidance, adjudication decisions, and known corrections.

Factcheck-Bench used pairs of in-house fact-checking-aware reviewers, consensus, a third rater, and serial review stages; it discarded cases that remained irreconcilable ([Wang et al., 2024](https://aclanthology.org/2024.findings-emnlp.830/)). AVeriTeC used a multi-round process and reported κ=0.619. These are useful precedents, but a product set should retain an explicit ambiguous/unresolved category rather than discard every difficult case, because difficult cases are where abstention must be evaluated.

Report raw agreement and chance-corrected agreement per decision stage, not one global number. Cohen's κ fits two reviewers with nominal categories; weighted κ fits ordered categories; Fleiss' κ fits more than two fixed raters; Krippendorff's α can accommodate different scales and missing judgments. Agreement coefficients have different assumptions and no universal “good” cutoff, so pair them with confusion tables and adjudication rates ([Artstein and Poesio, 2008](https://aclanthology.org/J08-4004/)). High agreement is not sufficient evidence of validity; annotation-quality research recommends validation across rounds and post-adjudication error checks as well ([Klie et al., 2024](https://direct.mit.edu/coli/article/50/3/817/120233/Analyzing-Dataset-Annotation-Quality-Management-in)).

For span and evidence-set decisions, categorical κ is inappropriate by itself. Report span F1/overlap, evidence-set precision/recall, and pairwise sufficiency agreement. For importance, report weighted agreement and the distribution of disagreements.

### Gold-set size options for the later HITL ticket

Final sample size should be determined from a pilot using the required upper confidence bound on consequential error, the number of reporting slices, and expected clustering within Videos. Three planning options are:

| Option | Approximate scope | Suitable use | Limitation |
| --- | --- | --- | --- |
| Lean shadow set | 100–150 Videos; roughly 800–1,500 material claims; full double review on a representative subset and every negative/ambiguous result | Pipeline comparison and internal shadow decision | Confidence intervals will be wide for rare verdicts, adversarial failures, and Transcript strata; not strong evidence for a public numeric score. |
| Balanced beta set | 250–350 Videos; roughly 2,000–3,500 material claims; all key decisions independently double-reviewed; oversampled boundary and failure cases reported separately | Recommended basis for a low-risk, feature-flagged beta if pilot variance supports the gates | Still insufficient for high-risk domains, multilingual claims, or a stable public author/video score. |
| High-assurance set | 500+ Videos; 4,000+ material claims; double review plus domain-expert strata, repeated temporal evaluation, and a larger randomized user study | Later broad rollout or evaluating an aggregate score | Substantially higher cost; broadening topics still requires domain-specific power analysis and policy review. |

These are budgeting ranges, not statistical guarantees. The HITL ticket should calculate the achieved interval for every blocking metric and use the lower/upper confidence bound, not the point estimate, when deciding launch.

## Transcript-error stratification

Evaluate each sampled Video twice where possible:

1. against a human-corrected, speaker-attributed reference Transcript; and
2. against the exact production Transcript received by the Evidence Check.

Use NIST's Speech Recognition Scoring Toolkit for reproducible word-error alignment ([NIST SCTK](https://www.nist.gov/itl/iad/mltg/tools)), but do not treat word error rate (WER) as sufficient. WER weighs words equally and can miss semantic severity; peer-reviewed ASR work finds it can correlate poorly with human judgment and downstream performance ([Whetten and Kennington, BioNLP 2023](https://aclanthology.org/2023.bionlp-1.6/)). Named-entity extraction is especially sensitive to spontaneous speech and ASR artifacts ([Szymanski et al., ACL 2023](https://aclanthology.org/2023.acl-long.98/)).

Report by WER bin and Transcript source:

- claim-selection recall delta from corrected to production Transcript;
- normalized-claim semantic preservation;
- **claim-critical error rate** for entities, numbers, dates, units, negation, modality, comparison direction, and quoted speaker;
- verdict-flip and abstention-flip rates caused by Transcript differences;
- timestamp alignment error;
- speaker-attribution error; and
- end-to-end risk-coverage curves for each Transcript stratum.

Add controlled perturbations that change one critical token while holding ordinary WER nearly constant: “can”/“cannot,” 15/50, million/billion, before/after, increase/decrease, and speaker A/speaker B. Also test benign substitutions with higher WER but preserved meaning. This exposes why a low aggregate WER is not a launch gate for factual verification.

## Learner comprehension and overreliance

Technical correctness does not establish that the interface helps Learners reason correctly. Explanations can increase acceptance of AI recommendations whether they are correct or not ([Bansal et al., CHI 2021](https://arxiv.org/abs/2006.14779)); cognitive-forcing designs can reduce overreliance but may reduce subjective satisfaction ([Buçinca, Malaya, and Gajos, CSCW 2021](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml)). Showing confidence can improve trust calibration without necessarily improving human-AI team performance ([Zhang, Liao, and Bellamy, FAT* 2020](https://arxiv.org/abs/2001.02114)). Consequently, satisfaction, perceived trust, and time-on-task cannot substitute for behavioral accuracy.

Run a randomized study on realistic Video tasks with balanced correct, incorrect, abstained, and missing-material-claim outputs. Compare at least:

- Transcript/Summary without Evidence Check;
- verdict-first claim cards;
- evidence-first claim cards with supporting and contradicting passages visible; and
- any proposed confidence/coverage presentation.

Seed known system errors under controlled conditions; otherwise overreliance cannot be measured. Primary outcomes should be:

- factual comprehension and belief accuracy after using the feature;
- **overreliance**: accepting an incorrect Evidence Check conclusion when the available evidence permits correction;
- appropriate reliance on correct conclusions and appropriate rejection of wrong ones;
- detection of omitted central claims;
- understanding of Supported versus Unresolved, confidence versus coverage, and claim verdict versus author/channel judgment;
- ability to identify which citation supports which claim;
- retention after a delay, if feasible; and
- subgroup differences by prior knowledge, information literacy, and accessibility needs.

Secondary outcomes include source opening, task time, cognitive load, usefulness, and satisfaction. A launch gate should prevent a material decrease in decision accuracy or increase in overreliance versus the no-Evidence-Check control, using a predeclared non-inferiority margin and confidence interval. It should also require that most participants correctly explain that the report assesses selected claims, not the moral character or general trustworthiness of the author.

## Launch-gate options for the HITL decision

### Gate architecture

Use blocking gates, not a compensatory weighted average. Excellent citation formatting must not offset a reversed verdict; high accuracy must not offset missing central claims; low selective risk must not offset near-total abstention.

Every blocking metric should have:

- a predeclared eligible population and unit of analysis;
- an allowed direction and threshold;
- a two-sided estimate plus the relevant one-sided 95% confidence bound;
- minimum sample counts for each required slice;
- a regression allowance against the last accepted system; and
- an owner and remediation path.

### Candidate gate profiles

The numbers below are decision options, not findings from the public benchmarks. They are intentionally framed so the later HITL ticket can tighten or relax them after a pilot and power analysis.

| Dimension | Exploratory shadow | Low-risk beta candidate | Later scored/broad product candidate |
| --- | --- | --- | --- |
| Material-claim recall | Measure and diagnose; no public output | Lower 95% bound ≥ 0.80 overall and ≥ 0.70 in every required slice | Lower bound ≥ 0.90 overall and ≥ 0.85 for central claims in every required slice |
| Normalization faithfulness | ≥ 0.90 human pass rate point estimate | Lower bound ≥ 0.95; zero known polarity/quantity/entity reversals in final test | Lower bound ≥ 0.98 with slice gates |
| Citation correctness | ≥ 0.90 human precision point estimate | Lower bound ≥ 0.95; URL resolution ≥ 0.99 | Lower bound ≥ 0.98 and citation completeness lower bound ≥ 0.95 |
| Contrary-evidence handling | Diagnostic only | Lower bound ≥ 0.85 recall on conflict-enriched set | Lower bound ≥ 0.90 plus calibrated Mixed/Unresolved labels |
| Verdict quality | Macro-F1 and class metrics reported | Contradicted precision lower bound ≥ 0.90; no required verdict class below 0.75 F1 | Stricter per-class thresholds set from user harm; no consequential slice regression |
| Selective prediction | Plot risk-coverage | At the chosen working point, upper 95% bound on consequential selective risk ≤ 0.05 while claim coverage lower bound ≥ 0.60 | Upper bound ≤ 0.02 at coverage lower bound ≥ 0.75 |
| Correct abstention | Reasons and confusion reported | Lower bound ≥ 0.90 recall for ineligible/missing-visual/unreliable-Transcript cases | Lower bound ≥ 0.95 with unnecessary-abstention ceiling |
| Temporal integrity | Audit violations | Zero known forbidden post-date leakage; all evidence carries temporal metadata | Same, plus drift gates and scheduled re-evaluation |
| Adversarial control | Attack suite runs | Zero observed instruction-following/control-flow violations; poisoned-verdict risk meets beta selective-risk gate | Expanded adaptive red team, source-poisoning slice, and regression gate |
| Learner outcome | Formative study | No material accuracy harm or overreliance increase versus control; ≥ 80% understand score scope and abstention | Demonstrated comprehension benefit, non-inferior appropriate reliance, and subgroup review |

The “low-risk beta candidate” is the most defensible starting profile for the agreed feature-flagged beta, provided compliance and source-policy gates are separately cleared. It should not authorize a numeric Video or author score. A public aggregate score deserves the later, stricter profile plus evidence that Learners interpret it correctly.

### Automatic evaluators

Automatic entailment or LLM judges may run on every build, but they cannot be the sole blocking judge until validated against the frozen human set for the exact rubric. Report each judge's precision/recall, calibration, and disagreement with humans. Freeze judge model and prompt versions for comparisons, and rerun validation when either changes. Human review should adjudicate any final launch metric that depends on source authority, temporal meaning, materiality, satire, or contextual omission.

## Recommended evaluation package

For the next planning ticket, carry forward this concrete package:

1. Use FEVER, AVeriTeC, Factcheck-Bench subtasks, ALCE-style citation measures, and TSVer as separate public regressions.
2. Build a Video-first, human-adjudicated gold set using the balanced-beta planning range, followed by pilot-based power analysis.
3. Score every pipeline stage and define strict end-to-end correctness; never expose or gate on verdict accuracy alone.
4. Calibrate the full pipeline on held-out product data and choose an operating point from risk-coverage, with Video-clustered confidence intervals.
5. Make abstention reasons, temporal metadata, production-Transcript degradation, and adversarial retrieval part of the blocking scorecard.
6. Run a seeded-error Learner study before public exposure; verify comprehension of coverage, confidence, and the claim-level scope.
7. Treat the proposed numeric thresholds as candidate profiles for HITL deliberation, not inherited scientific standards.

This evaluation can justify an evidence-first, claim-level beta. It cannot justify calling a Video, author, or channel “trustworthy,” and no benchmark reviewed here validates such a construct.
