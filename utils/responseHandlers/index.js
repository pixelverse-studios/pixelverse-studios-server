const userErrors = require('./user/errors')
const userSuccess = require('./user/success')
const formErrors = require('./formInput/errors')
const generalSuccess = require('./general/success')

const buildResponse = {
    user: { errors: userErrors, success: userSuccess },
    form: { errors: formErrors },
    general: { success: generalSuccess }
}

module.exports = buildResponse
