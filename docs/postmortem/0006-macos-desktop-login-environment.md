# Post-mortem 0006: macOS GUI launch hid login-shell tools from Agent Bash

English | [中文](0006-macos-desktop-login-environment.zh.md)

Status: resolved

## Executive summary

The macOS desktop Agent could run Bash, but commands installed through Homebrew, pnpm, or a shell version manager returned `command not found` when the application started from Finder or Dock. Electron inherited the graphical session's minimal environment, and the subprocess service correctly forwarded that incomplete PATH. Tests and local development launched Electron from a terminal, so they supplied the missing directories and concealed the defect. Desktop main now imports missing login-shell exports before Host composition while preserving explicit launch values and PATH precedence; a real Electron test starts with a minimal PATH and verifies recovery.

## Summary

The local subprocess provider builds child environments from `process.env`, removing credentials and stale `DSH_*` values but intentionally preserving PATH and other ordinary launch variables. Bash therefore behaved correctly relative to the Electron process that owned it.

macOS does not start Finder and Dock applications through the user's terminal login shell. The desktop process received system directories such as `/usr/bin` and `/bin`, but not directories established by shell startup files. Bash invoked by an Agent inherited that minimal PATH, so an absolute `/opt/homebrew/bin/node` worked while the ordinary `node` command did not.

## Impact

Agent Bash calls in the macOS desktop application could not find common developer tools even though the same commands worked in the user's terminal. Affected commands failed with exit code 127. Filesystem search used its packaged absolute ripgrep override and could still work after the separate ASAR-path repair, which made the environment failure appear tool-specific during diagnosis.

No missing shell variable weakened sandboxing. The failure reduced available commands; subprocess credential scrubbing continued to apply after environment recovery.

## Timeline

- Desktop development and Electron e2e launches inherited the terminal or CI process environment.
- The packaged application launched successfully from Finder, and packaged smoke executed Agent Bash with the test runner's PATH.
- A live Agent probe showed `/opt/homebrew/bin/node` existed while bare `node` failed with exit code 127.
- Comparing the desktop process with a normal login shell showed the GUI-session PATH lacked package-manager directories.
- Desktop main began recovering exported login-shell variables before creating the Host environment snapshot, and the Electron e2e gained a minimal-PATH launch case.

## Root cause

The desktop launcher treated Electron's inherited environment as equivalent to a terminal launch environment. That equivalence holds when developers run Electron from a shell, but not when macOS LaunchServices starts an application from Finder or Dock.

The test matrix repeated the assumption. Unit and package tests correctly verified subprocess inheritance, while source Electron e2e and packaged runtime smoke both started from commands whose parent already had a developer PATH. No test represented a graphical macOS launch with only system PATH entries.

## Guardrails added

- Before Host composition on macOS, desktop main runs the configured absolute login shell once with login and interactive startup and reads its exported environment through bounded, marker-delimited NUL output.
- Existing Electron variables retain precedence. PATH preserves its existing entries first and appends only missing login-shell directories; volatile shell bookkeeping is not imported.
- Shell startup has a five-second timeout and a one-megabyte output bound. Failure or incomplete output emits a warning and leaves the inherited environment unchanged.
- [`launch-environment.spec.ts`](../../apps/desktop/tests/launch-environment.spec.ts) pins parsing, merge precedence, platform scope, and failure fallback.
- [`desktop-profile.e2e.ts`](../../apps/web/tests/desktop-profile.e2e.ts) launches macOS Electron with a system-only PATH and a temporary login-shell export, then verifies main recovered both before exercising normal application lifecycle.

## Lessons

- A desktop Agent's shell environment is a launcher concern. A subprocess provider cannot reconstruct variables that its parent never received.
- Terminal-started Electron tests do not represent Finder or Dock startup; macOS desktop coverage needs an explicit minimal-environment case.
- Importing a login environment must preserve direct launch intent. Replacing PATH would fix Finder launches while silently changing terminal and CI command precedence.
- Absolute packaged executables and user-facing shell commands need separate coverage: the former can work while the latter still fail on PATH lookup.
