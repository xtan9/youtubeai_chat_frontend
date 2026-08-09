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

**Summary**:
A concise, structured account of a Video that remains faithful to its Transcript.
_Avoid_: Abstract, recap

**Video Chat**:
A conversation about one Video whose answers use that Video's Transcript and Summary as the only source of truth.
_Avoid_: General chat, assistant

**Grounded Answer**:
An answer whose factual claims are supported by the Video. When the Video does not support an answer, the product says so rather than filling the gap with outside knowledge.
_Avoid_: AI answer, generated answer

**Timestamp Citation**:
A reference from a Grounded Answer or Transcript to a specific moment in the Video.
_Avoid_: Link, footnote

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
A versioned, language-independent representation of a Video's subject and meaning used to compare it with other Videos. A Video has one active profile per semantic model version, which may begin with discovery metadata and become richer when the Video gains a Summary.
_Avoid_: Embedding, search document

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
