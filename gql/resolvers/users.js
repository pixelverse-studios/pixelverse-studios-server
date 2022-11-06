const bcrypt = require('bcryptjs')

const User = require('../../models/User')
const {
    validateRegisterUser,
    validateLogin
} = require('../../utils/validators/validate-users')
const { generateToken, generateResetPwToken } = require('../../utils/token')
const buildResponse = require('../../utils/responseHandlers')
const {
    resetPasswordEmail
} = require('../../utils/mailer/user/resetPasswordEmail')

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
                console.log(buildResponse.form.errors.badInput(errors))
                return buildResponse.form.errors.badInput(errors)
            }

            const user = await User.findOne({ email })
            if (user) {
                return buildResponse.user.errors.emailInUse()
            }
            const salt = bcrypt.genSaltSync()
            const hashedPw = bcrypt.hashSync(password, salt)
            const newUser = new User({
                email,
                password: hashedPw
            })
            const savedUser = await newUser.save()
            const token = generateToken(savedUser)

            return buildResponse.user.success.registered(savedUser, token)
        } catch (error) {
            return new Error(error)
        }
    },
    async login(_, { email, password }) {
        const { errors, valid } = validateLogin({ email, password })
        if (!valid) {
            return buildResponse.form.errors.badInput(errors)
        }
        const sanitizedEmail = email.toLowerCase()
        try {
            const user = await User.findOne({ email: sanitizedEmail })
            if (!user) {
                return buildResponse.form.user.errors.userNotFound()
            }

            const match = bcrypt.compare(password, user.password)
            if (!match) {
                return buildResponse.user.errors.invalidCredentials()
            }

            const token = generateToken(user)
            console.log(`User (${sanitizedEmail}) logged in with token: ${token}
            `)
            console.log('-------')
            return buildResponse.user.success.loggedIn(user, token)
        } catch (error) {
            return new Error(error)
        }
    },
    async sendPasswordResetEmail(_, { email }) {
        try {
            if (!email) {
                return buildResponse.user.errors.invalidCredentials()
            }
            const user = await User.findOne({ email })

            if (!user) {
                return buildResponse.user.errors.userNotFound()
            }

            const token = generateResetPwToken(user)
            await resetPasswordEmail(email, token)

            return buildResponse.user.success.loggedIn(user, token)
        } catch (error) {
            throw new Error(error)
        }
    }
}

module.exports.UserQueries = {
    async getUser(_, { email }) {
        try {
            const user = await User.findOne({ email })
            if (user) {
                return buildResponse.user.success.fetchedUser(user)
            }

            return buildResponse.user.errors.userNotFound()
        } catch (error) {
            throw new Error(error)
        }
    },
    async getLoggedInUser(_, {}, context) {
        try {
            // const token = validateToken(context)
            const token = { valid: false, user: { email: null } }
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const user = await User.findOne({ email: token.user.email })
            return buildResponse.user.success.loggedIn(user)
        } catch (error) {
            throw new Error(error)
        }
    },
    async getAllUsers() {
        try {
            const users = await User.find()
            if (users?.length) {
                return buildResponse.user.success.allUsersFetched(users)
            }
            return buildResponse.user.errors.noUsersFound()
        } catch (error) {
            throw new Error(error)
        }
    }
}
