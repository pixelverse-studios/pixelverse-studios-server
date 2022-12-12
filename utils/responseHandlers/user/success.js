const USER_SUCCESS = 'UserSuccess'
const MULTI_USER_SUCCESS = 'MultipleUsersSuccess'
const DEV_HOURS_SUCCESS = 'DeveloperHoursSuccess'

const baseArrayResponse = ({ type, users }) => ({
    __typename: MULTI_USER_SUCCESS,
    users,
    succesType: type
})

const baseResponse = ({ type, data, token }) => {
    const response = {
        __typename: USER_SUCCESS,
        successType: type,
        ...data._doc
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
    registered: (user, token) =>
        baseResponse({ type: 'registered', user, token }),
    loggedIn: (user, token) => baseResponse({ type: 'loggedIn', user, token }),
    fetchedUser: (user, token) =>
        baseResponse({ type: 'fetchedUser', user, token }),
    allUsersFetched: users =>
        baseArrayResponse({ type: 'allUsersFetched', users }),
    hoursUpdated: user => baseResponse({ type: 'hoursUpdated', user }),
    fetchedDevHours: hours => devResponse(hours)
}
