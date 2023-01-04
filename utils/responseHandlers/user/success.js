const USER_SUCCESS = 'UserSuccess'
const MULTI_USER_SUCCESS = 'MultipleUsersSuccess'
const DEV_HOURS_SUCCESS = 'DeveloperHoursSuccess'

const baseArrayResponse = users => ({
    __typename: MULTI_USER_SUCCESS,
    users
})

const baseResponse = ({ user, token }) => {
    const response = {
        __typename: USER_SUCCESS,
        ...user._doc
    }

    if (token) {
        response.token = token
    }

    return response
}

const devResponse = hours => ({
    __typename: DEV_HOURS_SUCCESS,
    ...hours
})

module.exports = {
    registered: (user, token) => baseResponse({ user, token }),
    loggedIn: (user, token) => baseResponse({ user, token }),
    fetchedUser: (user, token) => baseResponse({ user, token }),
    allUsersFetched: users => baseArrayResponse(users),
    hoursUpdated: user => baseResponse({ user }),
    fetchedDevHours: hours => devResponse(hours),
    userDeleted: users => baseArrayResponse(users)
}
