const { VALID_EMAIL, VALID_PASSWORD } = require('../regex')

module.exports.isValidString = value => !!value
module.exports.isValidEmail = email => VALID_EMAIL.test(email)
module.exports.isValidPassword = password => VALID_PASSWORD.test(password)
