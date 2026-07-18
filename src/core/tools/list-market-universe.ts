import { z } from 'zod'

import { NOT_ADVICE } from '../config.js'
import { gql } from '../graphql/client.js'
import { type FacetsResponse, PRODUCT_FACETS } from '../graphql/queries.js'

export const listMarketUniverseArgs = {
  kind: z
    .enum(['supply', 'borrow'])
    .default('supply')
    .describe('Which side of the market to enumerate.'),
}

const Args = z.object(listMarketUniverseArgs)

/**
 * The discovery call. Every other tool takes an asset / chain / protocol filter,
 * and an agent that guesses those gets an empty result and no idea why. This
 * returns the values that actually exist, with counts, so it never has to guess.
 */
export async function listMarketUniverse(raw: unknown) {
  const { kind } = Args.parse(raw)

  const data = await gql<{ productFacets: FacetsResponse }>(PRODUCT_FACETS, {
    filters: { kind, active: true },
  })
  const { assets, chains, protocols } = data.productFacets

  return {
    kind,
    totalProducts: protocols.reduce((a, p) => a + p.count, 0),
    assets: assets.map((a) => ({ symbol: a.symbol, markets: a.count })),
    chains: chains.map((c) => ({ chainId: c.id, name: c.name, markets: c.count })),
    protocols: protocols.map((p) => ({ name: p.name, markets: p.count })),
    usage:
      'Use these exact values as the asset / chainId / protocol filters for ' +
      'find_best_markets. Any other value will match nothing.',
    disclaimer: NOT_ADVICE,
  }
}
