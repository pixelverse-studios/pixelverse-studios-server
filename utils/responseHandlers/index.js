const userErrors = require('./userErrors')
const formErrors = require('./formInputErrors')

const buildResponse = {
    user: userErrors,
    form: formErrors
}

module.exports = buildResponse
