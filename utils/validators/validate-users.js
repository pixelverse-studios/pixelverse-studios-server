const {
    isValidString,
    isValidEmail,
    isValidPassword
} = require('./validations')
const { buildUserError } = require('./builders')

module.exports.validateRegisterUser = ({
    email,
    firstName,
    lastName,
    password
}) => {
    const errors = []

    if (!isValidEmail(email) || !isValidString(email)) {
        errors.push({
            field: 'Email',
            message: 'Please enter a valid email.'
        })
    }

    if (!isValidString(firstName)) {
        errors.push({
            field: 'First Name',
            message: 'First name is required.'
        })
    }

    if (!isValidString(lastName)) {
        errors.push({
            field: 'Last Name',
            message: 'Last name is required.'
        })
    }

    if (!isValidPassword(password) || !isValidString(password)) {
        errors.push({
            field: 'Password',
            message:
                'Password is required, and should include at least 1 lowercase & uppercase letter, 1 special character, 1 number, and be minimum 8 characters long.'
        })
    }

    return {
        valid: errors?.length <= 0,
        errors
    }
}
