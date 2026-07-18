import { GRAPHQL_ENDPOINT } from '../config.js'
import { ApiError, postJson } from '../http.js'

export { ApiError, RateLimitedError } from '../http.js'

interface GraphQLResponse<T> {
  data?: T
  errors?: { message: string }[]
}

/** POST a GraphQL document and return `data`, or throw a typed error. */
export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const body = await postJson<GraphQLResponse<T>>(
    GRAPHQL_ENDPOINT,
    { query, variables },
    'The LendWise API'
  )

  // GraphQL reports errors in a 200 body, so this is the real error path.
  if (body.errors?.length) {
    throw new ApiError(body.errors.map((e) => e.message).join('; '))
  }
  if (!body.data) throw new ApiError('LendWise API returned no data.')
  return body.data
}
