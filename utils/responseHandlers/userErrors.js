const USER_ERROR = 'UserError'

module.exports = {
    userNotFound: () => ({
        __typename: USER_ERROR,
        errorType: 'userNotFound',
        message: 'No account was found with that email.'
    }),
    emailInUse: () => ({
        __typename: USER_ERROR,
        errorType: 'emailInUse',
        message:
            'A user with those credentials already exists. Please try again or hit Forgot Password'
    })
}
