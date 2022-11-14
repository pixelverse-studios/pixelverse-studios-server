const CLIENT_ERRORS = 'Errors'

module.exports = {
    noClientsFound: () => ({
        __typename: CLIENT_ERRORS,
        type: 'noClientsFound',
        message: 'No clients exist'
    })
}
