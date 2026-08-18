# Background Workflows — Plain English

This folder holds the background jobs for DevSummary. They are the work that happens **without anyone waiting on a web page**: pulling commits from GitHub, asking the AI to read them, writing briefs, and emailing them out.

Each one is a "workflow": a list of steps that runs in the background. If a step fails, it gets retried automatically. If the server restarts halfway through, it picks up where it left off.

They run in a **separate program** from the API. Start it with `pnpm dev:worker`. If that program is not running, nothing in this folder happens — briefs never generate, commits never sync.

You can watch them run live at **http://localhost:8080** (the Temporal UI).

---

## The 10 workflows

### 1. Noop — "is the background system alive?"

**What it does:** Nothing useful. Prints a message.

**When it runs:** Only when you ask it to, by calling the test endpoint.

**Why it exists:** To check that background jobs work at all. If this one runs, the plumbing is fine and your problem is elsewhere.

---

### 2. Sync Repo Collaborators — "who works on this repo?"

**What it does:** Asks GitHub for the list of people with access to one repository, and saves it. Those people are who you can pick when building teams or a per-person brief.

**When it runs:** Four moments:

- A repo gets connected to DevSummary
- A repo gets disconnected
- GitHub tells us someone was added or removed (a webhook)
- Someone clicks "sync" manually in the UI

---

### 3. Scan Repository — "new repo just connected, go get everything"

**What it does:** The big one that runs after you connect a repo. Two steps:

1. Download the repo's commits from GitHub — up to a year of history.
2. Hand those commits to the AI reader (workflow #5) so each one gets summarized.

If there are no new commits, it stops after step 1 instead of starting the AI.

**When it runs:** Right after a repository is connected during GitHub App install or a sync.

---

### 4. Backfill Commits — "go get commits from this date onward"

**What it does:** Downloads commits from GitHub for one repo, starting from a date you give it. That's all — it does **not** run the AI afterwards.

**When it runs:** Only when someone asks for it directly (an admin hitting the backfill endpoint, usually to fill a gap).

**How it differs from #3:** Scan Repository figures out the date itself and then chains the AI step. This one takes your date and stops.

---

### 5. Analyze Repo — "read every commit and describe it"

**What it does:** The AI step. For one repository:

1. Works out which commits still need reading.
2. Sends them to OpenAI in groups of 50. Each commit comes back with a type (`fix`, `feature`, `refactor`, `docs`, …), a summary, and a list of changes.
3. Saves each result so it never has to pay to read the same commit twice.

**When it runs:** Automatically after Scan Repository (#3), or when an admin triggers analysis for a repo.

**Two things worth knowing:**

- **One bad commit doesn't ruin the batch.** If OpenAI keeps failing on a single commit, that commit is marked failed and the other 49 carry on.
- **It splits itself up.** After 500 commits it hands the leftovers to a fresh copy of itself. A repo with 10,000 commits works fine — it just becomes 20 handoffs.

---

### 6. Generate Brief — "write one brief"

**What it does:** Takes one brief that's waiting to be written and finishes it:

1. Marks it as "in progress" — and stops immediately if someone else already claimed it. This is what makes it safe to accidentally trigger twice.
2. Figures out which commits belong to it (based on whether the brief is for a project, team, person, or repo), reads their AI summaries, and asks OpenAI for a plain-English title and summary aimed at non-technical readers.
3. Sends it out by email and/or Slack.

If the period had **zero commits**, it writes a "no activity" brief and skips the AI entirely — no cost.

If something went permanently wrong (for example the project it was for got deleted), it stops before sending rather than emailing a broken brief.

**When it runs:** Three ways:

- A schedule came due (started by #8)
- Someone clicked "generate now" in the UI
- It's filling in history for a new schedule (started by #7) — in this case it writes the brief but **does not send it**, because nobody wants 300 old emails

---

### 7. Backfill Briefs — "fill in the history for a new schedule"

**What it does:** When you create a new schedule ("weekly brief for Project X"), this creates the briefs for past periods too, so the dashboard isn't empty on day one. Up to 90 days back — that's the ceiling on history everywhere in the product. Then it kicks off Generate Brief (#6) for each — with sending **turned off**.

**When it runs:** Once, immediately after a schedule is created.

---

### 8. Dispatch Due Briefs — "whose brief is due right now?"

**What it does:** The clock-watcher. Every minute it checks all schedules, finds the ones whose next run time has passed, creates a fresh empty brief for each, moves their next run time forward, and starts Generate Brief (#6) for each — with sending **turned on**.

**When it runs:** Automatically every 60 seconds, forever, on a repeating timer that the API sets up when it boots.

If one run is still going when the next minute ticks, the tick is skipped rather than doubled up.

---

### 9. Backfill LOC Stats — "fill in the lines-of-code numbers"

**What it does:** Finds every repository still missing its lines-added/lines-removed numbers and starts one copy of #10 for each.

**When it runs:** Once, every time the worker program starts. Restarting the worker won't pile up duplicate runs.

**Note:** This is housekeeping across all organizations, so it stays invisible in the app's "background jobs" indicator on purpose.

---

### 10. Backfill Repo LOC Stats — "page through one repo's line counts"

**What it does:** Fills in lines-added/removed for one repository, a page at a time. When it finishes a page it waits 5 seconds, then starts a fresh copy of itself for the next page. Stops when there are no pages left.

**When it runs:** Started by #9, one per repository.

---

## How they connect

```
Repo connected
   └─ Sync Repo Collaborators (2)      ← who works here
   └─ Scan Repository (3)              ← get commits
        └─ Analyze Repo (5)            ← AI reads each commit
             └─ (repeats itself in 500-commit chunks)

Schedule created
   └─ Backfill Briefs (7)              ← create past briefs
        └─ Generate Brief (6) × many   ← written, NOT sent

Every 60 seconds
   └─ Dispatch Due Briefs (8)          ← anything due?
        └─ Generate Brief (6) × due    ← written AND sent

Worker starts
   └─ Backfill LOC Stats (9)
        └─ Backfill Repo LOC Stats (10) per repo
```

---

## If something looks stuck

1. **Is the worker running?** `pnpm dev:worker`. No worker means nothing in this folder executes, even though the API happily accepts the request and returns a job ID.
2. **Open http://localhost:8080.** Every run is listed there — Running, Completed, or Failed — with the exact error and how many times it retried.
3. **Failures retry themselves.** Most steps try 4 times with growing gaps between attempts. A red run in the UI has already given up; a running one may still recover.
4. **Briefs not sending?** Check whether it came from Backfill Briefs (#7) — those are intentionally never sent.

For the technical version — retry settings, determinism rules, how to add a new workflow — see [AGENTS.md](./AGENTS.md) in this folder.
