# Side panel design QA

## Scope

This review covers the reported conversation-header padding, side-panel tab density, full-bleed app content, drag-to-split feedback and four-direction docking, and the terminal's system-shell behavior. The reference screenshots document defects rather than a visual target, so the comparison checks that each defect is absent while preserving the product's existing color, type, and editor-density tokens.

## Evidence

- Original side-panel defect: `/Users/jgbingzi/.t3/userdata/attachments/447ee67a-9212-4473-adcb-d2ff736908eb-d80144df-23fc-496d-bfe5-90c4e6e35c6f.png`.
- Title-padding reference: `/Users/jgbingzi/.t3/userdata/attachments/447ee67a-9212-4473-adcb-d2ff736908eb-63afae53-ffa3-417f-a1a3-264698bf33f7.png`.
- Tab-padding reference: `/Users/jgbingzi/.t3/userdata/attachments/447ee67a-9212-4473-adcb-d2ff736908eb-3e5416af-297e-4e13-9377-afcb8ff5f033.png`.
- Terminal-shell reference: `/Users/jgbingzi/.t3/userdata/attachments/447ee67a-9212-4473-adcb-d2ff736908eb-06d32456-69cc-4f46-baa4-9a34808db194.png`.
- Final trajectory implementation: `/Users/jgbingzi/.t3/userdata/browser-artifacts/sidepanel-density-trajectory.png`, captured from a 2048 × 1218 CSS-pixel preview with `macos-hidden-inset` enabled.
- Final terminal implementation: `/Users/jgbingzi/.t3/userdata/browser-artifacts/terminal-system-shell-implementation.png` in the same viewport and state.
- Title comparison: `/Users/jgbingzi/.t3/userdata/browser-artifacts/titlebar-density-comparison.png`; reference and implementation regions are each normalized to 1762 × 186 before horizontal composition.
- Tab comparison: `/Users/jgbingzi/.t3/userdata/browser-artifacts/sidepanel-tab-density-comparison.png`; both regions are normalized to 182 × 108.
- Terminal comparison: `/Users/jgbingzi/.t3/userdata/browser-artifacts/terminal-shell-comparison.png`; both regions are normalized to 1050 × 1025.

## State and interactions

The final title-only conversation header computes to `32px 12px 10px` padding in the macOS hidden-inset carrier and 75px total height. The 32px top value remains the carrier's drag strip; left, right, and bottom padding are the reduced values under review. The side-panel strip computes to 28px, each tab cell to 28px with `2px 6px` padding and a 4px internal gap, and the app body begins directly below the one-pixel separator without an outer shell gutter.

The final terminal launched `/opt/homebrew/bin/fish -l`, inherited the user's Starship prompt and profile, and exposed `SHELL=/opt/homebrew/bin/fish` plus `TERM=xterm-256color` in the running PTY. The Client answered the primary device attributes query omitted by the pinned renderer, so fish reached its prompt immediately without the previous ten-second compatibility warning. The terminal remains an undecorated libghostty-vt canvas with only one painted cursor.

Dragging a tab still shows the five-target docking guide and half-pane or full-pane placement preview. The top and bottom targets remain independently reachable; drops create vertical splits, while left and right create horizontal splits. Tab close/add, switching, panel close, divider resize, and full-bleed Trajectory content remain active.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: dense trajectory labels can still truncate at very narrow persisted panel widths; the table remains scrollable and the panel remains resizable.
- The title header now has visibly balanced 12px horizontal insets and a smaller 10px lower inset while retaining the native-window drag area.
- The previous tall tab affordances are replaced by a compact 28px editor strip with symmetric 2px vertical and 6px horizontal padding.
- The system shell, its prompt, colors, and profile now replace the fixed `dsh>` Bash experience for human terminal attachments. Model terminal sessions remain controlled Bash.

## Console and comparison history

The final title, tabs, trajectory, and terminal interactions produced no side-panel runtime error. The first terminal comparison exposed two independent transport defects: the PTY provider forced `name: dumb`, and the pinned renderer omitted a primary device attributes response. The final comparison was captured after propagating `TERM=xterm-256color`, selecting the operating-system account shell, and adding the renderer-aware response fallback.

## Final result

passed
