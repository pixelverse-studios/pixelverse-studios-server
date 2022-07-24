import { UserQueries, UserMutations } from './users'
import { ClientQueries } from './clients'

const Query = {
    ...UserQueries,
    ...ClientQueries
}
const Mutation = {
    ...UserMutations
}
export { Query, Mutation }
