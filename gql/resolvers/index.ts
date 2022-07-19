import { Query as UserQueries, Mutation as UserMutations } from './users'

const Query = {
    ...UserQueries
}
const Mutation = {
    ...UserMutations
}
export { Query, Mutation }
