// Presentation only: exact literal paragraphs from the frozen Core Notes request.
// No JSON token search, arbitrary headings, links, instructions or extra prose.
export const CORE_README = "The gateway resolves context before routing."
export const CORE_DECISION = "The control plane uses PostgreSQL for PITR."
export function coreWikiParagraph(body,part) {
  if(typeof body!=="string"||body.length>512||!["initial","append"].includes(part))return false
  // Validation copy only. Consumers retain the original bytes for prefix,
  // digest, revision and readback checks. Strip at most one exact-title heading.
  let paragraph=body.replace(/\r\n?/g,"\n").trim()
  if(part==="initial")paragraph=paragraph.replace(/^(?:#{1,6}[ \t]+Core Notes(?:[ \t]+#+)?[ \t]*\n|Core Notes[ \t]*\n[ \t]{0,3}(?:=+|-+)[ \t]*\n)/,"").trim()
  if(paragraph.startsWith("> "))paragraph=paragraph.slice(2)
  for(const wrapper of ["**","__","*","_"])if(paragraph.startsWith(wrapper)&&paragraph.endsWith(wrapper)) {paragraph=paragraph.slice(wrapper.length,-wrapper.length);break}
  return paragraph===(part==="initial"?CORE_README:CORE_DECISION)
}
