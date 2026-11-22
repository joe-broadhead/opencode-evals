// The only new spaces mutations in this synthetic suite. No arbitrary case/account authority.
const source={action:"sources",bind:{source:"gmail",account:"quartz-synthetic"}}
const job={action:"jobs",job:{op:"draft",template:"slack-threads-project",project:"quartz",account:"quartz-synthetic"}}
const cases={"deep-mem-sources":source,"deep-mem-sources-p":source,"deep-mem-jobs":job,"deep-mem-jobs-p":job}
export const spacesDiscoveryIntent=id=>cases[id]?structuredClone(cases[id]):null
