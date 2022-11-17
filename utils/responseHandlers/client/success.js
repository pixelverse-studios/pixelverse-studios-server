const CLIENT_SUCCESS = 'ClientSuccess'

const baseResponse = ({ type, client, token }) => {
    const response = {
        __typename: CLIENT_SUCCESS,
        successType: type,
        ...client._doc
    }

    if (token) {
        response.token = token
    }

    return response
}

const baseArrayResponse = ({ type, clients }) =>
    clients.map(client => ({
        ...client._doc,
        __typename: CLIENT_SUCCESS,
        successType: type
    }))

module.exports = {
    clientAdded: client => baseResponse({ type: 'clientAdded', client }),
    clientUpdated: client => baseResponse({ type: 'clientUpdated', client }),
    clientFetched: client => baseResponse({ type: 'clientFetched', client }),
    allClientsFetched: clients =>
        baseArrayResponse({ type: 'allClientsFetched', clients })
}
