import { UserQueries, UserMutations } from './users'
import { ClientQueries, ClientMutations } from './clients'

const Query = {
    ...UserQueries,
    ...ClientQueries
}
const Mutation = {
    ...UserMutations,
    ...ClientMutations
}
export { Query, Mutation }
