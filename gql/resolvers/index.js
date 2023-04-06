const { UserQueries, UserMutations } = require('./users')
const { ClientQueries, ClientMutations } = require('./clients')
const { NewsletterMutations, NewsletterQueries } = require('./ggcNewsletter')

const Query = {
    ...UserQueries,
    ...ClientQueries,
    ...NewsletterQueries
}
const Mutation = {
    ...UserMutations,
    ...ClientMutations,
    ...NewsletterMutations
}
module.exports = { Query, Mutation }
