# pi-goal

Goal-directed autonomous work loops for [pi](https://github.com/earendil-works/pi-coding-agent).

Mirrors Claude Code's `/goal` interface:

```
/goal <condition>    # set a goal, start working immediately
/goal                # show goal status (condition, time, turns, reason)
/goal clear          # clear the active goal
```

## How it works

1. **Set a goal** — `/goal all tests pass and lint is clean`
   The condition is sent as a user message, kicking off the first turn immediately.

2. **Autonomous loop** — After each turn, a lightweight evaluator call (same configured model) checks:
   > Has the condition been met based on the agent's output?

3. **Continue or stop** — If not met, a `nextTurn` message triggers the next turn automatically. The agent keeps working until the condition is satisfied or you `/goal clear`.

## Usage

### What to use goals for

Substantial work with a verifiable end state:

- Migrating a module to a new API until every call site compiles and tests pass
- Implementing a design doc until all acceptance criteria hold
- Working through a labeled issue backlog until the queue is empty

### Effective conditions

A good condition has:
- **One measurable end state** — test results, build exit code, empty queue
- **A clear proof mechanism** — how the agent demonstrates it in its output

```
/goal all tests in test/auth pass and the lint step is clean
/goal refactor src/database to use connection pooling, verified by tests in test/db.test.ts
/goal write documentation for the public API until every exported symbol has a docstring
```

### Status display

While active, the footer shows the goal timer: `⏱ 3t · 2m 15s`

On completion: `✓ Goal achieved in 3 turns`

### Resuming

A goal that was still active when a session ended is restored automatically on resume.

## Installation

```bash
pi install git:github.com/kolt-mcb/pi-goal
```

Or from a full URL:

```bash
pi install https://github.com/kolt-mcb/pi-goal
```

Pi packages run with full system access — review the source before installing.

## Development

```bash
npm install        # install dev/peer dependencies
npm run typecheck  # tsc --noEmit
npm test           # run the smoke test
```

## Comparison with Claude Code `/goal`

| Feature | Claude Code | pi-goal |
|---------|-------------|---------|
| Slash interface | ✅ | ✅ |
| Same model for work + eval | ❌ (separate small model) | ✅ |
| Session persistence | ✅ | ✅ |
| Footer timer | ✅ | ✅ |
| Subagents | ❌ | ❌ |
