# pi-goal

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![pi package](https://img.shields.io/badge/pi-extension-5b54d6.svg)](https://github.com/earendil-works/pi-coding-agent)

> Goal-directed autonomous work loops for [pi](https://github.com/earendil-works/pi-coding-agent).

Set a goal as a single completion condition. After every turn, a lightweight
evaluator checks whether the condition is met. If it isn't, the agent is
automatically prompted to keep working — turn after turn — until the goal is
satisfied or you stop it. It's the autonomous counterpart to a plain prompt:
you describe the *end state*, not each step.

```
/goal all tests in test/auth pass and the lint step is clean
```

---

## Features

- **Single-condition goals** — describe a verifiable end state; the agent drives toward it.
- **Self-evaluating loop** — after each turn the configured model judges progress with a cheap yes/no call.
- **Live status** — a footer timer shows elapsed time and turn count while a goal runs.
- **Resumes across sessions** — an in-progress goal is restored automatically when you reopen the session.
- **Bounded** — a hard turn cap prevents a goal that never resolves from looping forever.

## Requirements

- [pi](https://github.com/earendil-works/pi-coding-agent) (`@earendil-works/pi-coding-agent`).
- A configured model — the same model that powers your session is reused for evaluation.

## Installation

From npm:

```bash
pi install npm:@koltmcbride/pi-goal
```

From git:

```bash
pi install git:github.com/kolt-mcb/pi-goal@v0.1.0
```

> ⚠️ Pi packages run with full system access. Review the source before installing.

## Usage

```
/goal <condition>    Set a goal and start working immediately
/goal                Show the active goal's status
/goal status         Alias for /goal
/goal clear          Clear the active goal (alias: /goal stop)
```

Re-issuing `/goal <condition>` while a goal is active replaces the condition
and restarts the loop with it.

### Writing effective conditions

A good condition has **one measurable end state** and **a clear way for the
agent to demonstrate it** in its output:

```
/goal all tests in test/auth pass and the lint step is clean
/goal refactor src/database to use connection pooling, verified by tests in test/db.test.ts
/goal every exported symbol in src/api has a docstring
```

Goals work best for substantial, verifiable work — migrating a module until
every call site compiles, implementing a design doc until its acceptance
criteria hold, or working through a backlog until the queue is empty.

### Status display

While a goal is active, the footer shows a live timer:

```
⏱ 3t · 2m 15s
```

`/goal` (or `/goal status`) prints the full state:

```
Condition: all tests in test/auth pass and the lint step is clean
Running:   2m 15s
Turns:     3
Last reason: one failing test remains in test/auth/login.test.ts
```

On completion the footer reports `✓ Goal achieved in 3 turns`.

## How it works

1. **Set** — `/goal <condition>` records the condition and sends it as the
   first prompt, kicking off work immediately.
2. **Evaluate** — at the end of each turn, the agent's text and tool results are
   summarized and passed to a minimal evaluator call on the same configured
   model: *has the condition been met?*
3. **Continue or stop** — if not met, a hidden continuation message is queued as
   the next turn with the latest evaluation reason, and the agent keeps working.
   When the evaluator returns *yes*, the loop stops and the result is reported.

A goal stops automatically when the condition is met, when you run `/goal clear`,
or after a safety cap of **120 turns** without success. State is persisted as
custom session entries, so a goal that was still running when a session ended is
restored on resume.

## Relationship to Claude Code's `/goal`

pi-goal mirrors the `/goal` interface from Claude Code, with a few differences:

| | Claude Code | pi-goal |
|---|:---:|:---:|
| Slash interface | ✓ | ✓ |
| Session persistence | ✓ | ✓ |
| Footer timer | ✓ | ✓ |
| Evaluation model | separate small model | your configured model (minimal reasoning) |

## Development

```bash
npm install        # install dev + peer dependencies
npm run typecheck  # tsc --noEmit
npm test           # run the smoke test
```

The extension is plain TypeScript; pi loads the source directly via the `pi`
manifest in [`package.json`](./package.json), so there is no build step.

## License

[MIT](./LICENSE) © Kolt McBride
