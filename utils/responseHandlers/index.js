const { userExistsError } = require('./userErrors')
const { formInputError } = require('./formInputErrors')

const buildResponse = {
    user: {
        userExistsError
    },
    form: {
        formInputError
    }
}

module.exports = buildResponse
