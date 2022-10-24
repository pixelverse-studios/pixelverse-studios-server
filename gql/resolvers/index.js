const { UserQueries, UserMutations } = require('./users')
const { ClientQueries, ClientMutations } = require('./clients')

const Query = {
    ...UserQueries,
    ...ClientQueries
}
const Mutation = {
    ...UserMutations,
    ...ClientMutations
}
module.exports = { Query, Mutation }
