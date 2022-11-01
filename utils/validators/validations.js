const { VALID_EMAIL, VALID_PASSWORD } = require('../regex')

const isValidString = value => !!value
const isValidEmail = email => VALID_EMAIL.test(email)
const isValidPassword = password => VALID_PASSWORD.test(password)

module.exports = { isValidString, isValidEmail, isValidPassword }
