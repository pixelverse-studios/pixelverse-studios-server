const { UserInputError } = require('apollo-server')
const bcrypt = require('bcryptjs')

const User = require('../../models/User')
const {
    validateRegisterUser
} = require('../../utils/validators/validate-users')
const { generateToken } = require('../../utils/token')
const buildResponse = require('../../utils/responseHandlers')

module.exports.UserMutations = {
    async register(_, { email, password, firstName, lastName }) {
        try {
            const { valid, errors } = validateRegisterUser({
                email,
                password,
                firstName,
                lastName
            })
            if (!valid) {
                return buildResponse.form.formInputError(errors)
            }

            const user = await User.findOne({ email })
            if (user) {
                return buildResponse.user.emailInUse()
            }
            const salt = bcrypt.genSaltSync()
            const hashedPw = bcrypt.hashSync(password, salt)
            const newUser = new User({
                email,
                password: hashedPw
            })
            const savedUser = await newUser.save()
            const token = generateToken(savedUser)

            return { ...savedUser._doc, id: savedUser._id, token }
        } catch (error) {
            return new Error(error)
        }
    }
}

module.exports.UserQueries = {
    async getUser(_, { email }) {
        try {
            const user = await User.findOne({ email })
            if (user) {
                return user
            }

            return buildResponse.user.userNotFound()
        } catch (error) {
            throw new Error(error)
        }
    },
    async getLoggedInUser(_, {}, context) {
        try {
            // const token = validateToken(context)
            const token = { valid: false, user: { email: null } }
            if (!token.valid) {
                throw new Error('Invalid User Token')
            }

            const user = await User.findOne({ email: token.user.email })

            return user
        } catch (error) {
            throw new Error(error)
        }
    },
    async getAllUsers() {
        try {
            const users = await User.find()
            if (users?.length) {
                return users
            }
            throw new UserInputError('No Users ', {
                errors: {
                    user: 'No users found'
                }
            })
        } catch (error) {
            throw new Error(error)
        }
    }
}
