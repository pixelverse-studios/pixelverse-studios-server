const USER_EXISTS = 'userExists'
const BAD_INPUT = 'badInput'
const REGISTERED = 'registered'

const UserErrorsMap = new Map()
UserErrorsMap.set(USER_EXISTS, {
    type: USER_EXISTS,
    message:
        'A user with those credentials already exists. Please try again or hit Forgot Password'
})

const BadInputErrorsMap = new Map()
BadInputErrorsMap.set(BAD_INPUT, {
    type: BAD_INPUT
})

const SuccessResponsesMap = new Map()
SuccessResponsesMap.set(REGISTERED, { type: REGISTERED, message: 'Welcome ' })

module.exports = {
    maps: {
        userErrors: UserErrorsMap,
        inputErrors: BadInputErrorsMap,
        successResponses: SuccessResponsesMap
    },
    types: { USER_EXISTS, BAD_INPUT, REGISTERED }
}
