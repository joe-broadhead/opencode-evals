// A successful full creation response is authority. Names, cidfiles and labels are not.
export const fullContainerID = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
export function creationOperation(args) {
  if (["run", "create"].includes(args[0])) return { kind: "container", name: args[args.indexOf("--name") + 1] }
  if (args[0] === "network" && args[1] === "create") return { kind: "network", name: args.at(-1) }
  return null
}
export function creationID(result) {
  const value = typeof result?.stdout === "string" ? result.stdout.trim() : ""
  return result?.code === 0 && fullContainerID(value) ? value : null
}
