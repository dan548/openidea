# PR #3773: Diff independence checks

Source baseline: f795aa32. PR head: 20e6179f. Only the rainbow scanner implementation was switched between original and fixed; both sides used the same current test suite, browser configuration, 2 workers and no retries. Twelve Diff cases were repeated three times per version: split caret navigation (both panes, alignment and reduced-motion variants), and the four 10k-line scattered-edit modes.

| Scanner | Passed | Failed | Scanner calls |
| --- | ---: | ---: | ---: |
| Original, 36 cases | 33 | 3 | 0 |
| Fixed, same 36 cases | 31 | 5 | 0 |
| Original, exact sync-scrolling case repeated 6 times | 5 | 1 | 0 |

The exact navigation failure reproduces on the original scanner: expected pane scroll positions to differ by less than 2px, observed 6600px. The exact original sync-scrolling failure expected the changed identifier `compute`; both panes remained at scrollTop=0 and viewport 0..1630, while the right selection moved to offset 5818. This is a Diff navigation/viewport failure, not evidence that the identifier lost its word decoration.

A temporary counter at BracketScanner.marks entry recorded zero calls in all 78 cases (the module was loaded in every case). DiffEditor.tsx uses viewerBase from cm.ts, which does not install rainbowBrackets. The changed literal-range function is only reached by the scanner. The recorded failures therefore reproduce independently of the code changed by this PR. Failure frequencies in this small timing-sensitive sample are not a performance comparison.

Temporary instrumentation only: module-load flag, scanner-entry counter, and an afterEach snapshot of counter/scroll/viewport/selection state. It did not change test actions or expectations. The original source and test files were restored after every run. No instrumentation or Diff changes are in the PR.

Files: original.log, fixed.log, original-sync.log, results.json. run.py preserves the audit procedure; its paths are specific to the local worktree. Use the normal Playwright command for the comparison:

```sh
pnpm e2e e2e/diff.spec.ts e2e/diff-navigation.spec.ts --grep "scattered edits, inserts and deletes|centres the visible caret during split navigation" --workers=2 --repeat-each=3
```
