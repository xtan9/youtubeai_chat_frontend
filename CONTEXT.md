# YouTube AI Chat

YouTube AI Chat helps high-volume YouTube learners understand individual videos quickly and explore them through evidence-grounded conversation.

## Language

**Learner**:
A person who uses YouTube AI Chat to understand many information-rich videos efficiently.
_Avoid_: Viewer, consumer

**Researcher**:
A person who uses a Workspace and Projects to investigate several Videos around an ongoing purpose. The same Researcher may be learning in one Project and creating in another.
_Avoid_: Learner account type, Creator account type

**Workspace**:
A Researcher's private environment for ongoing Projects.
_Avoid_: Project, team space

**Project**:
A named, bounded body of work within a Workspace that organizes Videos around an optional Project Goal.
_Avoid_: Workspace, playlist

**Project Goal**:
Optional guidance describing what a Researcher wants to learn, compare, or create in a Project. It is never evidence.
_Avoid_: Evidence, conclusion

**Source Set**:
The ordered set of canonical Videos associated with a Project as potential evidence.
_Avoid_: Transcript copy, playlist

**Source Coverage**:
An account of which Project Videos were ready and examined and which were unavailable for an evidence-based action.
_Avoid_: Sources used, completion percentage

**Video**:
A YouTube video known to YouTube AI Chat and identified by its YouTube video ID, whether discovered by the product or selected by a Learner. It may or may not yet have a Transcript, Summary, or Video Chat.
_Avoid_: Source, document, candidate

**Transcript**:
The time-ordered textual record of a Video's spoken content.
_Avoid_: Captions, script

**Transcript Passage**:
An exact, timestamped excerpt from one Video's Transcript, identified together with that Video.
_Avoid_: Summary, paraphrase, quote without Video identity

**Project Search**:
Direct retrieval of ranked Transcript Passages across a Project's ready Videos without generated interpretation.
_Avoid_: Project Conversation, AI search

**Project Conversation**:
A Researcher's durable thread of questions and Grounded Answers within one Project.
_Avoid_: Project Search, Video Chat

**Evidence Snapshot**:
The exact bounded Transcript Passages and Source Set revision used for one Grounded Answer.
_Avoid_: Full Transcript, Summary, Project Goal

**Evidence Relationship**:
The evidence-relative result of one Evidence Finding: Supported, Qualified, Conflicts, or Unresolved. It describes what the admissible evidence retrieved as of a stated date establishes about one claim, not whether a Video or person is truthful or trustworthy.
_Avoid_: Verdict, truth label, factuality rating

**Claim Unit**:
The smallest independently meaningful, checkable proposition that faithfully preserves every material element of one or more exact Transcript occurrences. Equivalent repetitions share one Claim Unit; related claims with any material difference do not.
_Avoid_: Sentence, factoid, topic

**Assertion Group**:
The original compound Transcript assertion and the Claim Units faithfully decomposed from it. It preserves the relationship among the parts without becoming another countable claim.
_Avoid_: Parent claim, claim count

**Claim Family**:
A non-counting diagnostic group of related but non-equivalent Claim Units. Membership never makes the claims interchangeable, affects selection or Coverage, or permits one to stand in for another.
_Avoid_: Duplicate claims, semantic cluster

**Material Claim Inventory**:
The complete, outcome-blind account of the distinct assertions found across one frozen Transcript, including each assertion's Central, Consequential-support, or Incidental role and its eligible or Excluded state. It is fixed before evidence retrieval and retains every omission.
_Avoid_: Selected claims, Findings list

**Material Inventory Entry**:
One countable Central or Consequential-support assertion in the Material Claim Inventory, represented by either an eligible Claim Unit or a distinct Excluded assertion. Incidental assertions, repeated occurrences, Assertion Groups, and Claim Families are not entries.
_Avoid_: Finding, source-backed claim

**Material Inventory Entry ID**:
A server-issued, replay-stable opaque identifier for exactly one countable Material Inventory Entry. Its tagged canonical input is either an eligible Claim Unit identity or an Excluded assertion's governed reason and exact Transcript anchors; an Excluded assertion never receives a Claim Unit ID.
_Avoid_: Provider ID, Claim Unit ID for an Excluded assertion

**Evidence Coverage**:
The unweighted share of all Material Inventory Entries that received a complete valid Evidence Finding. Unresolved Findings count as covered; Coverage does not measure support, accuracy, confidence, or source quality.
_Avoid_: Accuracy, confidence, completeness score

**Evidence Item**:
One exact, bounded passage from one identified state of an external resource, admitted for one versioned material-claim representation under a governed source policy. It carries its source identity, origin, scope, rights, and change policy; a link alone is not an Evidence Item.
_Avoid_: Source link, trusted website, search result

**Evidence Origin Group**:
The underlying record, study, dataset, event, press release, wire report, or expert from which one or more Evidence Items derive. Multiple reports from one origin count once when evaluating source independence.
_Avoid_: Domain, publisher score, citation count

**Evidence Set**:
The complete governed collection of Evidence Items and material supporting, qualifying, and contrary positions evaluated for one versioned material-claim representation. It is sufficient only when the source policy passes every required claim element, authority, independence, scope, rights, and conflict rule.
_Avoid_: Source list, search results, evidence score

**Evidence Check Run**:
One mutable, asynchronous attempt with frozen inputs and exactly one terminal outcome. It never exposes partial or invalid Findings.
_Avoid_: Report draft, retry attempt

**Evidence Report Version**:
One immutable, atomically published Evidence Check artifact containing complete validated Findings, Coverage, and provenance. A recheck creates a new Run and may publish a new version; it never edits an existing version.
_Avoid_: Run, mutable report

**Evidence Review Intake**:
A privacy-preserving external submission that never confirms whether a private Evidence Report exists. Authorized staff may optionally link it to an Evidence Review Case.
_Avoid_: Appeal vote, Report lookup

**Evidence Review Case**:
An authorized, human-reviewed workflow concerning an exact Evidence Report or Finding Version. A material correction publishes a new validated Evidence Report Version rather than editing the original.
_Avoid_: External Intake, in-place correction

**Evidence Gate Packet**:
One immutable, versioned body of reproducible decision evidence for a named Evidence Check action, cohort, system, policy, and observation window. Passing makes that action eligible for authorized owner review; it never changes rollout or entitlement automatically.
_Avoid_: Launch score, automatic rollout authorization

**Summary**:
A concise, structured account of a Video that remains faithful to its Transcript.
_Avoid_: Abstract, recap

**Video Chat**:
A conversation about one Video whose answers use that Video's Transcript and Summary as the only source of truth.
_Avoid_: General chat, assistant

**Grounded Answer**:
An answer whose factual claims are supported by its Evidence Snapshot. When the available evidence does not support an answer, the product says so rather than filling the gap with outside knowledge.
_Avoid_: AI answer, generated answer

**Timestamp Citation**:
A reference from a Grounded Answer or Transcript to a specific source Video and moment in that Video.
_Avoid_: Link, footnote

**Evidence Check**:
A Learner-requested asynchronous assessment of material, checkable claims in one Video against external evidence, with Findings tied to the relevant Timestamp Citations. It reports what governed evidence can and cannot establish without judging a speaker, author, or channel as trustworthy.
_Avoid_: Author trust score, channel credibility score, legitimacy score

**Evidence Finding**:
One complete, validated claim-level record containing the original context, Evidence Relationship, governed evidence and citations, as-of date, limitations, and server-owned `confidence: unavailable`.
_Avoid_: Verdict, truth label, fact score

**Evidence Eligibility**:
The deterministic, versioned preflight decision that an Evidence Check may run for a Video under the current policy, Transcript, topic, rights, and evidence constraints.
_Avoid_: Safe Video, trustworthy Video, approved content

**History**:
A Learner's retained record of previously processed Videos.
_Avoid_: Library, project

**Video Catalog**:
The shared collection of public Videos known to YouTube AI Chat and available for discovery and recommendation across Learners.
_Avoid_: History, search results, inventory

**Recommendation Candidate**:
A Video admitted as eligible to be considered for a Recommendation, whether or not it already has a Transcript or Summary. It is a role a Video plays, not a separate kind of Video.
_Avoid_: Candidate record, discovered video

**Recommendation Source**:
An independently verified public Video for which YouTube AI Chat may prepare a shared Recommendation Set.
_Avoid_: Any summarized Video, private source

**Recommendation**:
A versioned suggestion connecting a Recommendation Source to a Recommendation Candidate as a useful continuation.
_Avoid_: Search result, related video, advertisement

**Catalog Admission**:
The decision that a known Video may play the Recommendation Candidate role based on its discovery path, current availability, safety, freshness, and evidence.
_Avoid_: Catalog membership, successful Summary

**Catalog Nomination**:
A learner-unlinked proposal that a verified public Video undergo independent Catalog Admission after gaining a successful Summary.
_Avoid_: Automatic admission, promotion request

**Recommendation Set**:
The prepared collection of global Recommendations for one Recommendation Source before any Learner's private History is considered.
_Avoid_: Personalized feed, search results

**Recommendation Composition**:
The learner-private selection and ordering of a Recommendation Set using History and diversity without changing the shared Recommendations.
_Avoid_: Global ranking, personalization profile

**Continue Learning**:
The Summary-results surface that presents composed Recommendations after a successful Summary of a Recommendation Source.
_Avoid_: Feed, related videos, autoplay

**Shadow Recommendation**:
A fully prepared Recommendation retained for quality evaluation but not presented to Learners.
_Avoid_: Draft Recommendation, hidden card

**Recommendation Quality Gate**:
The explicit standard Shadow Recommendations must satisfy before Continue Learning becomes visible to Learners.
_Avoid_: Feature completeness, launch date

**Recommendation Review**:
A structured human judgment of a Shadow Recommendation against its admission, relationship, explanation, and usefulness requirements.
_Avoid_: Product analytics, model score

**Recommendation Rollout**:
The controlled progression of Continue Learning through off, shadow, pilot, and on states while preserving an immediate kill switch.
_Avoid_: Deployment, release date

**Continuation Relationship**:
The learning relationship that explains why a Recommendation follows its source Video: deeper explanation, prerequisite, practical application, or credible alternative.
_Avoid_: Similarity type, ranking reason

**Recommendation Explanation**:
A short learner-facing account of the Continuation Relationship between a Recommendation and its source Video.
_Avoid_: Score, model rationale

**Semantic Profile**:
A versioned, language-independent representation of a Video's subject and meaning used to compare it with other Videos. The first implementation is a strict server-validated JSON profile produced asynchronously by the existing LLM Gateway and stored with one active profile per Video and profile schema version only after private evaluation and human-approval ledger records authorize the exact model/schema/prompt tuple; durable requests bind that activation and deterministic Postgres concept overlap retrieves candidates. A future vector or hybrid representation requires a new versioned decision.
_Avoid_: Embedding, search document, hidden similarity score

**Recommendation Evidence**:
The Semantic Profile and evidence level that meet the relationship-specific threshold for a Recommendation and its Explanation.
_Avoid_: Model rationale, hidden score

**Recommendation Assessment**:
A versioned judgment that a candidate Video has a supported Continuation Relationship to a source Video, together with the Explanation and Recommendation Evidence for that judgment.
_Avoid_: Live model response, ranking score

**Recommendation Feedback**:
A Learner's explicit judgment that a Recommendation was useful or not useful, optionally accompanied by a reason.
_Avoid_: Click, engagement signal

**Summarize Next**:
The Learner's deliberate selection of a Recommendation as the subject of a new Summary.
_Avoid_: Autoplay, open recommendation

**Discovery Demand**:
An aggregated, learner-unlinked need for more Videos in a topic and language where the Video Catalog cannot provide adequate Recommendations.
_Avoid_: Live search, recommendation request

**Discovery Observation**:
A learner-unlinked, dated record that an external discovery provider returned a Video for a topic and language at a particular position.
_Avoid_: Raw response, search result

**Discovery Budget**:
The configured allowance that limits external acquisition and is allocated among aggregated Discovery Demands.
_Avoid_: User quota, request limit

**Processing Budget**:
A configured allowance that independently limits external semantic profiling or Recommendation Assessment work.
_Avoid_: Discovery Budget, Learner entitlement

**Inactive Video**:
A known Video that cannot currently be a Recommendation Candidate because it is unavailable, private, non-embeddable, or backed only by expired provider metadata.
_Avoid_: Deleted Video, stale row

**Remembered Session**:
An authenticated Learner's continuing access in one browser profile, independent of Remembered Sessions on other devices or profiles. It survives browser restarts and ends only through Sign Out, Sign Out Everywhere, Account Recovery, or administrative revocation.
_Avoid_: Login state, auth token

**Sign Out**:
The Learner's deliberate termination of the Remembered Session in the current browser profile only.
_Avoid_: Log out everywhere, revoke account access

**Sign Out Everywhere**:
The Learner's deliberate termination of every Remembered Session for their account, including sessions on other devices and browser profiles.
_Avoid_: Sign out

**Account Recovery**:
The process by which a Learner establishes a new password after proving control of their email account. Completion preserves the recovery browser's new Remembered Session and terminates every pre-existing Remembered Session.
_Avoid_: Password change, login

**Smoke Account**:
A marked, non-human account used only by automated production checks. It follows real product flows and quotas but is excluded from business analytics and real-user totals, and it must never be used as a Learner's personal account.
_Avoid_: Learner, personal account

**Channel Steward**:
An 18+ Researcher whose OAuth grant resolves to one Supported Creator Channel and who is authorized to publicly represent that Channel while reviewing its interactions. It is a role, not an account type.
_Avoid_: Creator account type, Viewer, consumer

**Connected YouTube Channel**:
The YouTube channel whose identity a Researcher has explicitly authorized YouTube AI Chat to use for a bounded channel-management action.
_Avoid_: YouTube account, Creator profile

**Interaction Assessment**:
A provisional judgment about observable behavior in a YouTube comment or reply, kept separate from any judgment about its author.
_Avoid_: Troll detection, author score, personality label

**Actionable Abuse**:
An interaction that clearly targets the Channel Steward with a non-severe direct insult, degrading language, or targeted provocation and contains no Safety Flag condition.
_Avoid_: Troll, keyboard warrior, unhappy person

**Reviewable Interaction**:
An interaction whose meaning depends on context that is not yet established, such as sarcasm, quotation, reclaimed language, or a relationship-specific joke.
_Avoid_: Low-confidence abuse, suspicious author

**Allowed Criticism**:
Negative feedback, disagreement, or content-focused criticism that does not target a person with Actionable Abuse.
_Avoid_: Hostile opinion, negative sentiment

**Reply Draft**:
Proposed response text that remains private until a Channel Steward deliberately reviews and publishes it for one interaction.
_Avoid_: AI reply, automated response

**Public Reply**:
Text deliberately published to YouTube under a named Connected YouTube Channel after the Channel Steward reviews its final content and context.
_Avoid_: Draft, scan result

**Safety Flag**:
A private, response-blocking notice that an interaction contains a threat, self-harm encouragement, doxxing, stalking, extortion, sexual harassment, protected-class hate, minor risk, or another credible real-world safety concern.
_Avoid_: Reply recommendation, author danger score

**Review Decision**:
A Channel Steward's explicit per-interaction choice to dismiss an assessment, revise a Reply Draft, publish its final text, or continue with a YouTube enforcement action.
_Avoid_: Model decision, bulk approval

**Assessment Context**:
The bounded current-thread and Video identity information needed to interpret one interaction without building a cross-Video profile of its author.
_Avoid_: Author history, behavioral profile

**Review Queue**:
The private collection of Reviewable Interactions, Actionable Abuse, and Safety Flags awaiting a Channel Steward's Review Decision.
_Avoid_: Comments inbox, automated moderation log

**Channel Hub**:
The registered product surface where a Channel Steward reviews and acts on interactions for a Connected YouTube Channel without changing account type or Project context.
_Avoid_: Creator mode, Creator dashboard, Project

**Publishing Authorization**:
The Channel Steward's separate, explicit grant that permits a reviewed final response to be published under one Connected YouTube Channel.
_Avoid_: Channel connection, scan permission

**Read-only Grace Period**:
The bounded time after paid access ends during which a former Channel Steward may inspect, export, delete, or disconnect existing Channel data but cannot create new assessments, drafts, or Public Replies.
_Avoid_: Free Channel access, subscription extension

**Active Connected Channel**:
The one Connected YouTube Channel currently selected for new scans, assessments, drafts, and Public Replies; changing it never transfers work from another Channel.
_Avoid_: Default account, current Workspace

**Supported Creator Channel**:
A Connected YouTube Channel that represents one public creator persona and whose OAuth identity can be verified for every Channel action.
_Avoid_: Multi-host organization, delegated Studio Channel

**Publication Uncertain**:
A state in which YouTube may have accepted a Public Reply but the product lacks enough verified provider state to declare it published or safely retry it.
_Avoid_: Failed reply, retryable error

**Scan Run**:
A Channel Steward-initiated, bounded attempt to discover and assess recent interactions for one Active Connected Channel, with explicit progress and coverage.
_Avoid_: Background monitoring, complete channel scan

**Stale Draft**:
A Reply Draft whose source interaction or Assessment Context changed after generation and therefore requires regeneration before publication.
_Avoid_: Failed draft, editable draft
