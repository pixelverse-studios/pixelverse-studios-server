const USER_ERROR = 'UserError'

module.exports.userExistsError = () => ({
    __typename: USER_ERROR,
    errorType: 'userExists',
    message:
        'A user with those credentials already exists. Please try again or hit Forgot Password'
})
