# YouTube AI Chat

YouTube AI Chat helps high-volume YouTube learners understand individual videos quickly and explore them through evidence-grounded conversation.

## Language

**Learner**:
A person who uses YouTube AI Chat to understand many information-rich videos efficiently.
_Avoid_: Viewer, consumer

**Video**:
A YouTube video selected by a Learner as the subject of a Transcript, Summary, and Video Chat.
_Avoid_: Source, document

**Transcript**:
The time-ordered textual record of a Video's spoken content.
_Avoid_: Captions, script

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
