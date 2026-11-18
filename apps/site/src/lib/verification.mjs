// The "Verified" column of the product's platform table (docs/platforms/platforms.md). Until
// 2026-11 the product had two tiers for runs against a real API, "Sandbox verified" and
// "Production verified"; it then made them one, "Verified". Both are read, so the site builds
// whichever product commit is pinned.

const LIVE = new Map([
  ['Production verified', 'production'],
  ['Sandbox verified', 'sandbox'],
  ['Verified', null],
])

/** Whether an adapter at this level has run against the platform's real API. */
export const isVerifiedLive = (level) => LIVE.has(level)

/** The environment a home-page tile names, or null when the product does not split them. */
export const levelTag = (level) => LIVE.get(level) ?? null
