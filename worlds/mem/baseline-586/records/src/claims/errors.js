/**
 * A claim, a projection line or a mark was refused, with a code and a next
 * step. The claims layer is internal to the service, so it does not carry an
 * HTTP status: the filing path decides where the refusal goes.
 */
export class ClaimsError extends Error {
  constructor(code, message, next) {
    super(message)
    this.name = "ClaimsError"
    this.code = code
    this.next = next
  }
}
