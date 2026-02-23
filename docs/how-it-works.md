# How It Works

## The Problem

AI agents have no memory between sessions. Every new conversation starts blank — the agent doesn't know what happened yesterday, what was decided, or what to do next. Within a session, things degrade too: the context window fills up, old information gets forgotten, and the agent starts repeating itself or ignoring earlier decisions.

This isn't a model problem. It's an infrastructure problem. The models are capable — they just have nothing to work with.

## The Session Lifecycle

Buffer manages four phases of every session:

### Recover

When a new session starts, the agent reads `HANDOFF.md` — a structured file written by the previous session containing exactly what this session needs: what was being worked on, where it stopped, key outcomes, open questions, and next steps. The agent also reads `MEMORY.md` for the bigger picture: current priorities, active projects, important people.

This takes seconds. The agent orients itself without re-reading old conversations, asking what happened, or guessing.

Without Buffer, the agent either starts from scratch (losing all context) or loads bloated memory files (wasting context window on irrelevant history).

### Work

During the session, Buffer enforces intake discipline and monitors for degradation.

**Intake discipline** means being intentional about what enters the context window. Before loading any content, the agent checks: Has this file changed since I last read it? Do I need all of it, or just a section? Can I reference it instead of loading it? Will editing this file break prompt caching?

Every token that enters the context window stays there for the rest of the session. Careless loading — re-reading unchanged files, dumping full outputs instead of summaries, loading entire files when a grep would do — fills the window with noise and pushes out useful context.

**Degradation monitoring** uses percentage-based thresholds that adapt to any model's context window:

| Zone | Usage | What Happens |
|---|---|---|
| 🟢 Green | Under 25% | Full performance. No restrictions. |
| 🟡 Yellow | 25–40% | Be intentional about loading. Prefer targeted reads. |
| 🟠 Orange | 40–50% | Warn the owner. Degradation begins on complex tasks. |
| 🔴 Red | Over 50% | Wrap immediately. Quality is compromised. |

Buffer also watches for behavioral signals that indicate the context is degrading:

- **Repeating itself** — the agent restates things it already said (context distraction)
- **Forgetting decisions** — the agent contradicts or re-asks about resolved questions (retrieval failure)
- **Ignoring earlier context** — the agent only uses recent information (recency bias)
- **Referencing wrong information** — earlier errors get treated as facts (context poisoning)

If the agent notices any of these patterns, it warns the owner and recommends wrapping. The signals indicate context quality is degrading — continuing risks compounding the problem, but the owner decides when to wrap.

### Persist

Buffer doesn't wait for session end to save important information. As decisions happen during the session, key outcomes get captured immediately — to `HANDOFF.md`, to a memory system, or to a scratch file.

The test is simple: if this session crashed right now, would important stuff survive?

This continuous persistence means session end isn't a desperate scramble to capture everything. Most of the important work is already saved.

### Bridge

When the session ends — because the owner says "wrap session," the context hits 50%, or the conversation naturally concludes — Buffer extracts outcomes from the session and writes a structured `HANDOFF.md`:

```markdown
# HANDOFF.md

## Current Work
What the session was focused on.

## Stopping Point
Exactly where things left off.

## Key Outcomes
- Conclusions, not activities. "X works because Y" — not "tested X."

## Open Questions
- Unresolved items the next session needs to address.

## Next Steps
1. Most important first. No more than five.
```

This file is the bridge between sessions. It's capped at 2KB — enough for a productive session's conclusions, small enough to load instantly. It's overwritten every wrap, not appended to. The current state matters, not the history.

`MEMORY.md` only gets updated if something structural changed: a new project, a priority shift, a new key person. Most sessions don't touch it.

## The Five Pillars

Buffer addresses five areas that determine whether your agent works well over time:

### 1. Context Window Management
The context window is a cache, not a database. Buffer treats it that way — controlling what loads, tracking usage, detecting degradation, and wrapping before quality drops. Thresholds are percentage-based so they work across models with different window sizes.

### 2. Session Continuity
Sessions don't exist in isolation. Every session is part of a sequence. Buffer ensures each session knows what the previous one accomplished and what comes next, through structured handoffs that carry forward conclusions — not transcripts.

### 3. Skill Reliability
Skills are only useful if the agent actually uses them. Buffer ensures `AGENTS.md` has the right structure: skill triggers positioned where the agent checks them first, negative triggers that catch bypass patterns, and a pre-response checkpoint that gates every reply through the skill system.

### 4. Boot File Effectiveness
Every workspace file the agent loads at startup costs tokens and influences behavior. Buffer keeps these files lean and purposeful: `AGENTS.md` under 4KB of imperatives (not descriptions), `MEMORY.md` under 1.5KB of current state (not history), `HANDOFF.md` under 2KB of conclusions (not activities).

### 5. Memory Hygiene
Memory files accumulate. Old session logs, verbose transcripts, duplicate information, ghost files that the agent never reads — all of it silently degrades performance by consuming context without contributing value. Buffer audits and maintains these files on a regular cadence.

## Two Skills, One System

Buffer ships as two skills that work together:

**`buffer`** is the runtime. It runs every session — recovering context on start, monitoring during work, persisting decisions continuously, and writing structured handoffs at the end. It's lightweight by design because it loads into every session.

**`buffer-optimizer`** is the auditor. It runs occasionally — on first install for setup, then weekly or when things feel off. It measures your boot payload, audits your AGENTS.md structure, classifies skills by usage, checks memory files for bloat, and produces a report with prioritized recommendations.

They're the same system at different timescales. Buffer manages the session. Buffer Optimizer manages the workspace that sessions depend on.

On first run, `buffer` automatically extracts `buffer-optimizer` if it's not already installed. After that, they operate independently.
