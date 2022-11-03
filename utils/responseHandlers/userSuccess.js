const USER_SUCCESS = 'UserSuccess'

const baseResponse = (type, user) => ({
    __typename: USER_SUCCESS,
    successType: type,
    ...user
})

const baseArrayResponse = (type, users) =>
    users.map(user => ({
        ...user._doc,
        __typename: USER_SUCCESS,
        successType: type
    }))

module.exports = {
    registered: user => baseResponse('registered', user),
    loggedIn: user => baseResponse('loggedIn', user),
    fetchedUser: user => baseResponse('fetchedUser', user),
    allUsersFetched: users => baseArrayResponse('allUsersFetched', users)
}
