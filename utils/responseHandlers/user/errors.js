const USER_ERROR = 'Errors'

module.exports = {
    invalidCredentials: () => ({
        __typename: USER_ERROR,
        type: 'invalidCredentials',
        message:
            'Invalid email or password. Please try again or hit Forgot Password'
    }),
    userNotFound: () => ({
        __typename: USER_ERROR,
        type: 'userNotFound',
        message: 'No account was found with that email.'
    }),
    noUsersFound: () => ({
        __typename: USER_ERROR,
        type: 'noUsersFound',
        message: 'No users exist'
    }),
    emailInUse: () => ({
        __typename: USER_ERROR,
        type: 'emailInUse',
        message:
            'A user with those credentials already exists. Please try again or hit Forgot Password'
    }),
    invalidToken: () => ({
        __typename: USER_ERROR,
        type: 'invalidToken',
        message: 'Token missing or invalid'
    }),
    matchingPasswords: () => ({
        __typename: USER_ERROR,
        type: 'matchingPasswords',
        message: 'New password must be different than the previous password.'
    })
}
