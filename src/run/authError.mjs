// What a refused sign-in looks like in a run's output, shared by the runner (which classifies a run as it ends) and the
// trace (which classifies a recording a runner did not mark).

/**
 * The host's or the provider's word that a model call was refused authentication: HTTP 401 or 403 from the provider
 * (a proxy's refusal of a tunnel aside), an authentication or permission error, an expired, invalid or revoked token,
 * or the sign-in prompt.
 */
export const AUTH_ERROR = /\b(?:status|code|http|error)[ :=\-"]*40[13]\b|\b40[13]\s+(?:unauthori[sz]ed|forbidden)|unauthori[sz]ed|authentication[_ ]error|permission[_ ]error|invalid[_ ](?:x-api-key|api[_ ]key|bearer|token|grant)|invalid (?:x-api-key|api key|bearer token|token)|oauth token (?:has )?expired|token (?:has )?expired|failed to authenticate|(?:oauth )?token (?:has been )?revoked|not logged in|please run \/login|login required/i

/**
 * Did the run end on its sign-in being refused, whatever the model did before? A run whose last event is an
 * authentication error (the token was revoked or expired mid-run) was cut short by infrastructure: never the model's.
 */
export function endedOnAuth(stdout = "") {
  const lines = String(stdout).split("\n").filter((line) => line.trim())
  if (!lines.length) return false
  try {
    const last = JSON.parse(lines[lines.length - 1])
    const text = JSON.stringify(last)
    return (last.type === "error" || last.part?.type === "error") && AUTH_ERROR.test(text) && !/tunnel|proxy/i.test(text)
  } catch {
    return false
  }
}
