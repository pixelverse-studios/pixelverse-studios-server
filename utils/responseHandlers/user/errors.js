const USER_ERROR = 'UserErrors'

module.exports = {
    invalidCredentials: () => ({
        __typename: USER_ERROR,
        userErrorType: 'invalidCredentials',
        message:
            'Invalid email or password. Please try again or hit Forgot Password'
    }),
    userNotFound: () => ({
        __typename: USER_ERROR,
        userErrorType: 'userNotFound',
        message: 'No account was found with that email.'
    }),
    noUsersFound: () => ({
        __typename: USER_ERROR,
        userErrorType: 'noUsersFound',
        message: 'No users exist'
    }),
    emailInUse: () => ({
        __typename: USER_ERROR,
        userErrorType: 'emailInUse',
        message:
            'A user with those credentials already exists. Please try again or hit Forgot Password'
    }),
    invalidToken: () => ({
        __typename: USER_ERROR,
        userErrorType: 'invalidToken',
        message: 'Invalid token provided'
    })
}
