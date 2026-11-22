/**
 * The Jobs-only payment guard (J4 integration review, item 1).
 *
 * **It is not part of the shared shapes module.** `mem_remember`, a commitment
 * and every other normal save keep `main`'s behaviour: a gift card for a
 * leaving do, a routing table's entry count and a rotated shared password are
 * ordinary sentences. What this module refuses is **collected text** that
 * carries payment material, and only the `extract` engine uses it, before a
 * proposal is written.
 */
const PAYMENT = [
  // An IBAN: a real country code, two check digits, then 11 to 30 alphanumerics.
  // A known list, so "UK20 hostnames" is not an IBAN.
  /\b(?:AL|AD|AT|AZ|BH|BE|BA|BR|BG|CR|HR|CY|CZ|DK|DO|EE|FO|FI|FR|GE|DE|GI|GR|GL|GT|HU|IS|IE|IL|IT|JO|KZ|XK|KW|LV|LB|LI|LT|LU|MK|MT|MR|MU|MD|MC|ME|NL|NO|PK|PS|PL|PT|QA|RO|LC|SM|ST|SA|RS|SC|SK|SI|ES|SE|CH|TL|TN|TR|UA|AE|GB|VA|VG)\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/,
  // An account written as a/c or acct, a sort code, a routing number.
  // "a/c 41234567", not "acct 2024 budget": an account number is six digits or more.
  /\b(?:a\/c|acct)\b[^\n]{0,12}?\d{6,}\b/i,
  /\bsort\s*code\b[^\n]{0,12}\d{2}[- ]?\d{2}[- ]?\d{2}\b/i,
  // A routing number, named as one: a routing table's count is not one.
  /\brouting\s*(?:no\.?|number|#)\b[^\n]{0,12}\d{6,9}\b/i,
  /\brouting\b\s*[:=]\s*\d{6,9}\b/i,
  // The gift-card scam needs a code or a number: buying a card as a gift is
  // an ordinary sentence, sending its code is the scam.
  /\bgift\s?cards?\b[^.\n]{0,80}\b(?:codes?|numbers?|scratch|pin|digits)\b/i,
  // An account number, named as one: a marker, then the digits.
  /\b(?:account|acct)\b[^.\n]{0,20}?\b(?:no\.?|number|#|ending|ends)\b[\s:#-]*\d{4,}\b/i,
  /\b(?:account|acct)\b\s*[:#]\s*\d{4,}\b/i,
  // A CVV, however it is named.
  /\b(?:cvv2?|cvc2?|cvn|card security code|security code)\b[^.\n]{0,20}\b\d{3,4}\b/i,
  // A login written out.
  /\blogin\s*[:=]\s*\S+\s*[/,]\s*\S+/i,
  // A one-time code, a PIN, or "your code is …".
  /\b(?:otp|one[ -]?time (?:code|password|passcode)|verification code|2fa code)\b[^.\n]{0,24}\b\d{4,8}\b/i,
  /\b(?:your|the)\s+(?:code|pin|passcode)\s*(?:is|:)\s*\d{4,8}\b/i,
  /\bpin\b\s*(?:is|:|=)\s*\d{4,8}\b/i,
  // A gift card's number.
  /\bgift\s?card\b[^.\n]{0,40}\b(?:\d[ -]?){8,}\b/i,
  // A card fragment: a marker (ending, last four, a mask, a network) beside the
  // last four digits, and an expiry date. A card reader and "ending in March"
  // carry no digits and pass.
  /\b(?:card|acct|account)\b[^.\n]{0,24}\b(?:ending|ends)\b[^.\n]{0,12}\d{4}\b/i,
  /\bending\s+in\s+[•*xX#\s-]*\d{4}\b/,
  /\blast\s+(?:four|4)\b[^.\n]{0,12}\d{4}\b/i,
  /[•*xX#]{2,}[\s-]*\d{4}\b/,
  /\b(?:visa|mastercard|master\s?card|amex|american\s+express|discover|maestro)\b[^.\n]{0,40}\d{4}\b/i,
  /\bcard\s*(?:no|number|#)\.?\s*[^\n]{0,16}\d{4,}/i,
  /\bexp(?:iry|ires?|iration)?\.?\s*[:#-]?\s*\d{1,2}\s*\/\s*\d{2,4}\b/i,
  // A crypto address: hex, bech32, or base58.
  /\b0x[0-9a-fA-F]{40}\b/,
  /\bbc1[0-9a-z]{25,62}\b/i,
  /\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b/,
]

/** "the password is X": a value that looks like a secret, not a policy ("rotated quarterly"). */
function passwordShaped(value) {
  const match = /\b(?:password|passwd|pwd)\s*(?:is|:|=)\s*("[^"]{4,80}"|'[^']{4,80}'|\S+)/i.exec(String(value ?? ""))
  if (!match) return false
  const secret = match[1].replace(/^["']|["']$/g, "").replace(/[.,;:]+$/, "")
  if (secret.length < 4) return false
  // A digit or a symbol is a value. A letters-only token is a password too when
  // it stands alone ("password is hunter"); two words are prose ("rotated
  // quarterly").
  if (/\d/.test(secret) || /[^A-Za-z0-9]/.test(secret)) return true
  const alone = /(?:^|\s)(?:password|passwd|pwd)\s*(?:is|:|=)\s*["']?([A-Za-z]{4,})["']?\s*[.!]?$/i.exec(value)
  return Boolean(alone) || (/[a-z]/.test(secret) && /[A-Z]/.test(secret))
}

/** True when a run of 13 to 19 digits passes the Luhn check. */
function luhnIn(value) {
  for (const match of String(value ?? "").matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
    const digits = match[0].replace(/\D/g, "")
    if (digits.length < 13 || digits.length > 19) continue
    let sum = 0
    let double = false
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let digit = Number(digits[i])
      if (double) {
        digit *= 2
        if (digit > 9) digit -= 9
      }
      sum += digit
      double = !double
    }
    if (sum % 10 === 0) return true
  }
  return false
}

/** True when the text carries payment, card or credential material. */
export function paymentShaped(text) {
  const value = String(text ?? "")
  return PAYMENT.some((pattern) => pattern.test(value)) || passwordShaped(value) || luhnIn(value)
}
