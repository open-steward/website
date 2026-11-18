// product-patches/*.patch: fixes to the product's docs that this site needs before the product
// carries them. fetch-product.mjs applies them to .product/ after each fetch.

/**
 * Applies the patches in order to the checkout `git` runs in.
 *
 * A patch that applies is applied. One that applies in reverse is already in the product, most
 * likely because the product took the same fix: it is reported in `upstream`, so it can be
 * deleted, and the checkout is left as it is. One that does neither stops with an error.
 *
 * @param {(...args: string[]) => Buffer} git  runs git in the checkout
 * @param {{ name: string, file: string }[]} patches
 * @returns {{ applied: string[], upstream: string[] }}
 */
export function applyPatches(git, patches) {
  const applied = []
  const upstream = []
  for (const { name, file } of patches) {
    if (succeeds(git, 'apply', '--check', '--whitespace=nowarn', file)) {
      git('apply', '--whitespace=nowarn', file)
      applied.push(name)
    } else if (succeeds(git, 'apply', '--check', '--reverse', '--whitespace=nowarn', file)) {
      upstream.push(name)
    } else {
      throw new Error(
        `product-patches/${name} no longer applies, and the product does not carry it either: ` +
          'redo it against the new commit, or delete it if the fix is no longer needed',
      )
    }
  }
  return { applied, upstream }
}

function succeeds(git, ...args) {
  try {
    git(...args)
    return true
  } catch {
    return false
  }
}
