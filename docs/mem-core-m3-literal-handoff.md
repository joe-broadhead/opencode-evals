# Core M3: complete literal arguments

Base: signed `91d8a94901d4bda54ed556f1fa4b417d839c7f63`.
The task branch preserves the earlier `f846f27f915a2f83a95481f58812979917133406` branch and evidence.
This correction requires independent delta review.

## Fault and correction

The source fallback accepted a literal prefix as the complete argument.
Five independent expressions returned PASS for `core-forget` instead of BLOCKED.
The examples contain operators, a conditional, member access, index access, and addition after the initial object.
No test executes those strings.

Memory opts into `readLiteral(text, {complete:true})` and requires an object root.
Complete mode uses the existing reader position and token readers.
Only one closed supported literal plus trailing whitespace or closed comments can succeed.
Operators, extra arguments, expressions, unmatched delimiters, and unterminated trivia remain unresolved.
Memory recognizes all four JavaScript line terminators in line comments.
Thus a CR or Unicode line terminator cannot hide an operator as comment text.

Complete mode preserves uncertainty throughout the traversal.
An unknown value or spread cannot become certain after a later property overwrites its marker.
Unsupported escapes, numeric forms, interpolated templates, shorthand references, and computed keys also remain unresolved.
Supported string escapes include escaped quotes, backslashes, slashes, newline, and tab.
The reader does not evaluate JavaScript or implement a second expression parser.

The preferred private-hook argument path does not change.
Scoped actual arguments still override uncertain source text.
An actual wrong action still fails the core oracle.
Missing source certainty produces BLOCKED, not a guessed action or a product failure.

## Optional API compatibility

The return shape remains `{ok,value}` or `{ok:false,why}`.
The new option defaults to false.
All four internal generic calls still use the original default behavior.
Those calls serve bound literals, inner-call extraction, and dataflow.
Memory is the only production caller that requests complete mode.
No new executable dependency or digest-inventory entry is necessary.

The generic analyser tests retain their existing expectations.
An isolated comparison imports the signed baseline reader and the corrected reader.
All 1,512 default-API comparisons match across literal reading, bound literals, extraction, dataflow, and return-key lookup.
The corpus includes prefix expressions, markers, comments, nested values, malformed input, and primitive values.

## Evidence

The unchanged reviewer probe first reproduced 22 expected results and five false passes.
After the correction, all 27 results match, including BLOCKED for the original five expressions.
The focused native/core tests also cover operators, trivia, escapes, nested uncertainty, and actual private-hook arguments.

The audited 30-file union remains unchanged.
That union plus the focused file and generic analyser file passes 154 tests without skips.
The focused file contributes 11 tests and three repeated imported gold tests.
The generic analyser contributes 12 tests.
The original independent checks pass 273 tests, the variations match 830 comparisons, and the retained diagnostic matches all 15 outcomes.
All 38 frozen contracts deeply equal the archived declarations.
All 143 archive hashes match.

Both edited readers already belong to the 32 actual grader digest inputs.
Independent digest arithmetic reproduces the reviewed baseline digest before the owned-copy changes.
The corrected digest is `4f9ff98bf1a1c99102535b2ff6c9d2fc6282b952b5b76cdfd63c82040e5cf4fe`.
An isolated change to either reader changes that digest, and restoration returns the same digest.
The task does not refresh compile or offline locks.
The lock owner must handle the later coordinated refresh.

## Preserved gates and ownership

M4, H2 receipt/codec integration, and M6 permission/creator integration retain their reviewed offline closure at the base.
Their blobs do not change in this correction.
The guard, runner, turn adapter, core/durable/Markdown/payload/creator modules, plans, digest inventory, and locks remain unchanged.
The task does not accept discovery completeness or its known base issues.
Real-host behavior, transport, runtime authorization, containment, paid scores, and release remain separate gates.
No merge into another checkout occurs.

The lead owns the retained task branch, worktree, and bounded sibling evidence for independent review and later integration.
The evidence records exact commands, red/green results, immutable probe hashes, byte-preservation checks, and cleanup receipts.
