const CLIENT_ERRORS = 'ClientErrors'

module.exports = {
    noClientsFound: () => ({
        __typename: CLIENT_ERRORS,
        userErrorType: 'noClientsFound',
        message: 'No clients exist'
    })
}
