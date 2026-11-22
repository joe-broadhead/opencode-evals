/**
 * The unsafe shapes of a text: instruction, permission, share
 * (memory-funnel-v1.md §7, §10). One module, two copies kept identical by
 * scripts/check-copies.mjs: records/src/shapes.js for the routines and the
 * store, src/shapes.js for the plugin's pinned block. The patterns are
 * anchored on the phrasing of an injected command, not on single words, so an
 * ordinary "I'll share the deck on Monday" survives.
 */

const INSTRUCTION = [
  /\b(?:ignore|disregard|forget|override) (?:(?:all|any|the|your|of|my) )*(?:(?:previous|prior|above|earlier|other|existing) )?(?:instructions|rules|directions|guidelines|prompts?)\b/i,
  /\b(?:you are|you're) now\b/i,
  /\breveal (?:the |your )?(?:secret|token|password|api key|credentials|system prompt)\b/i,
  /\b(?:print|show|repeat|override|replace|ignore|disregard) (?:the |your )?system prompt\b/i,
  /\b(?:new|updated) system prompt\b/i,
  /\b(?:do not|don't|never) (?:tell|mention|inform|alert) the (?:user|person|owner)\b/i,
  /\b(?:when|if|once|after) you (?:read|see|recall|retrieve|load|process|summari[sz]e) (?:this|these)\b/i,
  /\b(?:note|message|instructions?) (?:to|for) (?:the |any )?(?:ai|assistant|agent|llm|model|bot)s?\b/i,
  /\b(?:ai|llm|assistant|agent|model)s?(?: (?:reading|processing|summari[sz]ing))? (?:this|these)[^.]{0,40}\b(?:must|should|shall|will)\b/i,
  /\bfrom now on\b[^.]{0,60}\b(?:you|always|never|the assistant)\b/i,
  /\b(?:add|store|save|remember|record|write|create) (?:a |an |the )?(?:new )?(?:memory|preference|rule|constraint|instruction|decision)s? (?:that|saying|stating)\b/i,
  /\b(?:system|assistant)\s*:\s*\S/i,
  /<\s*\/?\s*(?:system|instructions?|assistant|im_start|im_end)\b/i,
  /\b(?:run|execute|eval) (?:the following|this) (?:command|code|script)\b/i,
]

const PERMISSION = [
  /\b(?:grant|give|assign|add)\b[^.]{0,40}\b(?:access|permissions?|admin|owner(?:ship)?|editor|write rights?)\b/i,
  /\b(?:make|set|promote)\b[^.]{0,30}\b(?:an? )?(?:admin|owner|editor)\b/i,
  /\ballow\b[^.]{0,40}\bto (?:read|write|access|edit|delete|see)\b/i,
  /\b(?:auto-?approve|approve (?:all|every|everything|any))\b/i,
  /\b(?:disable|turn off|bypass|skip)\b[^.]{0,20}\b(?:review|safety|filters?|guards?|checks?|approval|2fa|mfa)\b/i,
  /\b(?:transfer|hand over)\b[^.]{0,30}\b(?:ownership|the (?:space|vault|account))\b/i,
  // Standing approvals (FABLE records #4): "always approve shares from …",
  // "accept invites … without asking".
  /\b(?:always|automatically|auto-)\s*(?:approve|accept|grant|trust|allow)\b/i,
  /\b(?:approve|accept|allow|grant|share|forward|send)\b[^.]{0,60}\bwithout (?:asking|confirm(?:ing|ation)|review(?:ing)?|approval|checking|permission)\b/i,
  /\bapprove\b[^.]{0,40}\b(?:shares?|share requests?|access requests?|invites?|invitations?|permissions?|grants?)\b/i,
  /\b(?:ignore|disregard|bypass|override)\b[^.]{0,30}\b(?:rules?|polic(?:y|ies)|protocol|permissions?)\b/i,
]

const SHARE = [
  /\b(?:share|send|forward|export|upload|post|leak|email|copy|dump)\b[^.]{0,40}\b(?:all|every|entire|whole|everything|your)\b[^.]{0,30}\b(?:memor(?:y|ies)|notes|records|journals?|vault|pages|data|contacts|inbox|mail|files|credentials|passwords?|secrets?|tokens?|keys)\b/i,
  /\b(?:share|send|forward|export|copy)\b[^.]{0,30}\b(?:memor(?:y|ies)|vault|journals?|records)\b[^.]{0,40}\b(?:to|with)\b/i,
  /\bmake\b[^.]{0,40}\bpublic\b/i,
  /\b(?:publish|expose)\b[^.]{0,30}\b(?:memor(?:y|ies)|notes|vault|journals?|pages)\b/i,
  /\bshare everything\b/i,
  /\b(?:all|every|everything)\b[^.]{0,30}\b(?:memor(?:y|ies)|notes|records|journals?|vault|pages|data)\b[^.]{0,20}\b(?:shared|sent|forwarded|exported|published|public(?:ly)?)\b/i,
  /\bshared? (?:it |them |this |these |everything )?(?:publicly|with (?:everyone|anyone|the public))\b/i,
]

/**
 * Which unsafe shapes a text has.
 * @param {string} text
 * @returns {{instruction: boolean, permission: boolean, share: boolean, any: boolean}}
 */
export function shapes(text) {
  const value = String(text ?? "")
  const instruction = INSTRUCTION.some((p) => p.test(value))
  const permission = PERMISSION.some((p) => p.test(value))
  const share = SHARE.some((p) => p.test(value))
  return { instruction, permission, share, any: instruction || permission || share }
}
