const userErrors = require('./userErrors')
const userSuccess = require('./userSuccess')
const formErrors = require('./formInputErrors')
const generalSuccess = require('./generalSuccess')

const buildResponse = {
    user: { errors: userErrors, success: userSuccess },
    form: { errors: formErrors },
    general: { success: generalSuccess }
}

module.exports = buildResponse
