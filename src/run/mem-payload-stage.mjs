// Relocate only static imports for the two isolated copies. The reviewed validator/Markdown bytes stay identical.
import {readFileSync,writeFileSync,copyFileSync} from "node:fs"
import {join} from "node:path"
export function stageCorePayload(root){
  const source=readFileSync(new URL("./mem-intent-plan.mjs",import.meta.url),"utf8")
  writeFileSync(join(root,"mem-intent-plan.mjs"),source.replace('"../grade/adapters/mem-core-markdown.mjs"','"./mem-core-markdown.mjs"'),{mode:0o600})
  copyFileSync(new URL("../grade/adapters/mem-core-markdown.mjs",import.meta.url),join(root,"mem-core-markdown.mjs"))
}
