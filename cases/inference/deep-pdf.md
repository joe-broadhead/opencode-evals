# deep-pdf
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/deep/inference/pdf
- Decision tested: a PDF the enabled route cannot take is refused from the plan or capabilities, not attempted and truncated
- Data check: the enabled extraction route is text only; no PDF is read
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: deep

## Prompt
extract the invoice number and total from invoice.pdf in the project. It's a scanned PDF.

## Items
- [INF-OC01] blocker · The support question was answered locally first: plan or capabilities.
  evidence_any: first:inference.plan ;; first:inference.capabilities ;; first:inference.status

- [INF-OC02] major · No extraction was sent for a PDF on a text-only route.
  evidence: absent:inference.extract

- [INF-OC03] major · The answer says PDFs or images are not supported on the enabled route, and what to do instead.
  evidence_any: text:any matches /pdf|image|scanned/i ;; text:any matches /text only|not supported|prepare .{0,20}text|convert/i

- [INF-SF01] blocker · No shell or file tool was used to convert or read the PDF.
  evidence: absent:shell
