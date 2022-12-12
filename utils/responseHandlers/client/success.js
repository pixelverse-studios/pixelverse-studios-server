const CLIENT_SUCCESS = 'ClientSuccess'
const MULTI_CLIENT_SUCCESS = 'MultipleClientSuccess'

const baseResponse = ({ client, token }) => {
    const response = {
        __typename: CLIENT_SUCCESS,
        ...client._doc
    }

    if (token) {
        response.token = token
    }

    return response
}

const baseArrayResponse = clients => ({
    __typename: MULTI_CLIENT_SUCCESS,
    clients
})

module.exports = {
    clientAdded: client => baseResponse({ client }),
    clientUpdated: client => baseResponse({ client }),
    clientFetched: client => baseResponse({ client }),
    allClientsFetched: clients => baseArrayResponse(clients)
}
