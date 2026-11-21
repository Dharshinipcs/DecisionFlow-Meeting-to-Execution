# DecisionFlow

> **From meeting decisions to verified execution.**

DecisionFlow is a stateful **Meeting-to-Execution Agent** that turns meeting conversations into persistent organizational memory, detects conflicts and dependency risks against earlier decisions, requires human confirmation before consequential changes or external execution, creates real GitHub Issues after approval, monitors commitments, and reports personalized weekly digests.

---

## 1. Product Overview & Problem Statement

Teams do not fail because they lack meeting summaries—they fail because commitments made across separate meetings drift, contradict earlier decisions, violate prerequisite dependencies, or disappear without tracked ownership.

DecisionFlow implements the full stateful agentic loop:

> **UNDERSTAND → REMEMBER → REASON → CONFIRM → ACT → MONITOR → REPORT**

---

## 2. Why DecisionFlow Is Different From a Meeting Summarizer

| Capability | Typical Meeting Summarizer | DecisionFlow |
| :--- | :--- | :--- |
| Output | Ephemeral per-meeting bullet notes | Persistent structured + semantic organizational memory |
| Decision State | Static text paragraph | Versioned decision lineage (`PROPOSED` → `ACTIVE` → `SUPERSEDED`) |
| Cross-Meeting Awareness | None | Hybrid retrieval (SQL structured records + vector embeddings) |
| Conflict & Dependency Check | None | Detects decision contradictions & prerequisite schedule violations |
| External Execution | Auto-creates noisy tickets or none | Strict human-in-the-loop governance before creating GitHub Issues |
| Follow-Up | Manual | Deterministic deadline monitoring (`UPCOMING`, `AT_RISK`, `OVERDUE`) & weekly personal digests |

---

## 3. Architecture & Agent Orchestration

DecisionFlow coordinates specialized logical services around a single persistent SQLite database (with PostgreSQL + `pgvector` reference migrations included in `supabase/migrations/`):

1. **Meeting Understanding Agent** (`server/agents/meeting-agent.ts`) — Converts speaker-attributed transcripts into Zod-validated decisions (`PROPOSAL` vs `CONFIRMED_DECISION` vs `SUPERSESSION`), action items, owners, deadlines, dependencies, and open loops linked to exact `transcript_segments`.
2. **Memory & Embeddings Layer** (`server/memory/embeddings.ts`, `server/memory/retrieval.ts`) — Combines structured SQL queries over active decisions, actions, and dependencies with semantic vector similarity (`gemini-embedding-2` cosine similarity) stored in `memory_embeddings`.
3. **Conflict & Reasoning Agent** (`server/agents/conflict-agent.ts`) — Runs deterministic dependency date checks first, then invokes Gemini reasoning over retrieved historical evidence to classify conflicts (`DECISION_CONFLICT`, `DEPENDENCY_CONFLICT`, `DEADLINE_CONFLICT`, `OWNER_CONFLICT`, `SUPERSESSION`, `REVERSAL`) with severity, confidence, and provenance.
4. **Human Governance & Approval Layer** (`server/agents/approval-service.ts`) — Queues proposed decision transitions and actions in `approval_items` (`PENDING`). Only upon human `APPROVE` / `EDIT` does an old decision become `SUPERSEDED` (never deleted) and the new decision become `ACTIVE`.
5. **Execution Agent** (`server/agents/execution-agent.ts`, `server/github/issues.ts`) — Verifies `approval_items.status IN ('APPROVED', 'EDITED')` on the server before calling the GitHub Issues REST API, storing `external_tasks`, and writing audit events.
6. **Follow-Up & Digest Agents** (`server/agents/followup-agent.ts`, `server/agents/digest-agent.ts`) — Evaluates approaching, at-risk, and overdue deadlines deterministically and generates personalized per-person Weekly Execution Digests.
7. **Ask Memory Agent** (`server/agents/memory-qa-agent.ts`) — Answers natural-language questions strictly from retrieved database evidence with meeting citations, returning `"I don't have enough evidence in team memory to answer that confidently."` when evidence is insufficient.

### AI vs. Deterministic Responsibilities

- **AI-Driven**: Transcript understanding, proposal vs. decision interpretation, owner/deadline/open-loop extraction, semantic embeddings, conflict classification/explanation, natural-language Ask Memory answers, and weekly digest prose synthesis.
- **Deterministic Code**: Transcript segmentation, database transactions, decision lineage transitions (`SUPERSEDED` / `ACTIVE`), dependency date comparisons, approval governance enforcement, duplicate/idempotency guards, GitHub REST API calls, reminder scheduling math, and audit event creation.

---

## 4. Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend / API**: Node.js, Express (`server.ts`, `server/routes/api.ts`), Zod schema validation
- **AI & Embeddings**: Google GenAI SDK (`@google/genai`) using `gemini-4-hydrogen` (structured JSON outputs) and `gemini-embedding-2`
- **Database**: SQLite (`better-sqlite3`) with relational schema, foreign keys, indexes, and vector embedding storage (`supabase/migrations/001_initial_schema.sql` provides equivalent PostgreSQL + `pgvector` DDL)
- **External Execution**: GitHub Issues REST API

---

## 5. Primary Pages

1. **Dashboard** — Situational awareness, KPI strip, Needs Attention queue, reminders, recent meetings, decisions, and audit trail.
2. **Meetings** — Searchable meeting list, `.txt`/`.md`/paste transcript upload, processing status.
3. **Meeting Detail** — Extractions, speaker-attributed transcript with clickable evidence jump links, dependencies/conflicts, and agent activity timeline.
4. **Decision Memory** — Searchable decision ledger with non-destructive version lineage (`Dec 10 → Dec 5`).
5. **Conflicts & Approvals** — Hero Decision Inbox comparing previous active decisions, new proposals, linked dependencies, and transcript excerpts with Approve / Edit / Reject / Explain controls.
6. **Tasks** — Action items with risk indicators, status controls, GitHub Issue creation/sync, and full provenance inspector.
7. **Weekly Digest** — Per-person weekly execution digest reflecting live database state.
8. **Ask Memory** — Evidence-backed organizational memory Q&A with source citations.

---

## 6. Environment Variables

Configure via `.env` or runtime Secrets (see `.env.example`):

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Yes (for AI features) | Server-side Gemini API key |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-4-hydrogen` |
| `GITHUB_TOKEN` | For GitHub Issues | Personal access token or fine-grained token with `issues:write` |
| `GITHUB_OWNER` | For GitHub Issues | GitHub user or organization slug |
| `GITHUB_REPO` | For GitHub Issues | Target GitHub repository name |
| `DATABASE_PATH` | Optional | SQLite path (defaults to `./data/decisionflow.db`) |

---

## 7. Local Development & Testing

```bash
# Install dependencies
npm install

# Run full-stack development server on port 3000
npm run dev

# Typecheck
npm run lint

# Run automated tests
npm test

# Build for production
npm run build
npm start
```

---

## 8. Complete Demo Walkthrough (Acme Product Team)

1. Open DecisionFlow on **Dashboard** — inspect seeded **Acme Product Team**, **Payment Launch Planning** (Nov 18, active **Dec 10** decision), and **Security Review** (Nov 20, **Dec 8** security certification dependency).
2. Click **Upload Transcript** → click **Load Sample Transcript** (`Payment Launch Review`, Nov 21) → click **Upload & Process**.
3. Inspect **Meeting Detail** to see speaker-attributed transcript segments, the **Dec 5** proposal, Rahul's **Update launch checklist** action (Nov 23), and the detected conflict.
4. Open **Conflicts & Approvals** — inspect **Previous: Dec 10**, **New Proposal: Dec 5**, **Dependency: Security certification — Dec 8**, and transcript excerpts from both meetings.
5. Click **Approve** on the launch date change → **Dec 10** becomes `SUPERSEDED`, **Dec 5** becomes `ACTIVE`, and history is preserved in **Decision Memory**.
6. Approve **Update launch checklist** and click **Create GitHub Issue** (when GitHub env vars are configured) → real GitHub Issue is created and linked in **Tasks**.
7. Open **Ask Memory** and ask `"What is the current payment launch date?"` → returns **December 5**, cites the superseded Dec 10 decision and Dec 8 security certification dependency, and lists source meetings.
8. Open **Weekly Digest** for Priya or Rahul to view the updated decisions, tasks, reminders, and risks.

---

## 9. Known Limitations & Future Improvements

- GitHub Issue creation requires server-side `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO` environment variables; when absent, the server cleanly reports the missing configuration rather than simulating an issue.
- Embedded SQLite (`better-sqlite3`) is used by default for zero-config single-process persistence; PostgreSQL + `pgvector` migrations are included in `supabase/migrations/` for multi-instance cloud deployments.
- Future additions: automated webhook sync from GitHub Issues back to internal task state and scheduled cron notifications.
