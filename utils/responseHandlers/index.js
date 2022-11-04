const userErrors = require('./user/errors')
const userSuccess = require('./user/success')
const formErrors = require('./formInput/errors')
const generalSuccess = require('./general/success')
const clientSuccess = require('./client/success')
const clientErrors = require('./client/errors')

const buildResponse = {
    user: { errors: userErrors, success: userSuccess },
    form: { errors: formErrors },
    general: { success: generalSuccess },
    client: { errors: clientErrors, success: clientSuccess }
}

module.exports = buildResponse
