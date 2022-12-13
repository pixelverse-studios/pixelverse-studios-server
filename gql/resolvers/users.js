const bcrypt = require('bcryptjs')
const jwt_decode = require('jwt-decode')

const User = require('../../models/User')
const Clients = require('../../models/Clients')
const {
    validateRegisterUser,
    validateLogin,
    validatePassword
} = require('../../utils/validators/validate-users')
const {
    generateToken,
    generateResetPwToken,
    isTokenExpired
} = require('../../utils/token')
const buildResponse = require('../../utils/responseHandlers')
const {
    resetPasswordEmail
} = require('../../utils/mailer/user/resetPasswordEmail')
const { validateToken } = require('../../utils/token')

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
                return buildResponse.form.errors.badInput(errors)
            }

            const user = await User.findOne({ email })
            if (user) {
                return buildResponse.user.errors.emailInUse()
            }
            const salt = bcrypt.genSaltSync()
            const hashedPw = bcrypt.hashSync(password, salt)
            const newUser = new User({
                firstName,
                lastName,
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
    },
    async updatePassword(_, { email, newPassword, token }) {
        const decoded = jwt_decode(token)
        if (!token || !isTokenExpired(decoded.exp)) {
            return buildResponse.user.errors.invalidToken()
        }

        const { errors, valid } = validatePassword({ password: newPassword })

        if (!valid) {
            return buildResponse.form.errors.badInput(errors)
        }

        try {
            const sanitizedEmail = email.toLowerCase()
            const user = await User.findOne({ email: sanitizedEmail })

            if (!user) {
                return buildResponse.user.errors.userNotFound()
            }

            const isSamePassword = bcrypt.compareSync(
                newPassword,
                user.password
            )

            if (isSamePassword) {
                return buildResponse.user.errors.matchingPasswords()
            }

            bcrypt.genSalt(12, (err, salt) => {
                bcrypt.hash(newPassword, salt, async (error, hash) => {
                    user.password = hash
                    await user.save()
                })
            })

            const token = generateToken(user)
            return buildResponse.user.success.loggedIn(user, token)
        } catch (error) {
            throw new Error(error)
        }
    },
    async deleteUser(_, { id }, context) {
        try {
            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const user = await User.find({ _id: id })

            if (!user) {
                buildResponse.user.errors.userNotFound()
            }

            await User.findOneAndDelete({ _id: id })
            const users = await User.find()
            return buildResponse.user.success.userDeleted(users)
        } catch (error) {
            throw new Error(error)
        }
    },
    async updateDevHours(
        _,
        { email, date, hoursLogged, project, projectPhase },
        context
    ) {
        try {
            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const user = await User.findOne({ email })
            if (!user) {
                return buildResponse.user.errors.userNotFound()
            }

            const newHours = { date, hoursLogged, project, projectPhase }
            user.devHours = user?.devHours?.length
                ? [...user.devHours, newHours]
                : [newHours]
            await user.save()

            return buildResponse.user.success.hoursUpdated(user)
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
            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const user = await User.findOne({ email: token.user.email })
            const newToken = generateToken(user)
            return buildResponse.user.success.loggedIn(user, newToken)
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
    },
    async getDeveloperHours(_, {}, context) {
        try {
            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const users = await User.find()
            const clients = await Clients.find()

            let totalHours = 0
            const developers = []

            users.forEach(({ firstName, devHours, _id }) => {
                const developerData = {
                    name: firstName,
                    data: devHours,
                    _id
                }

                let devsTotalHours = 0
                devHours.forEach(item => {
                    devsTotalHours += item.hoursLogged
                    totalHours += devsTotalHours
                })

                developerData.totalHours = devsTotalHours
                developers.push(developerData)
            })

            const projectPhases = []

            clients.forEach(client => {
                client.project.phases.forEach(phase =>
                    projectPhases.push(phase._id.toString())
                )
            })

            const projects = []
            projectPhases.forEach(phase => {
                const hoursPerPhase = []
                let totalHoursInPhase = 0

                developers.forEach(dev => {
                    const devHoursPerPhase = []
                    dev?.data.forEach(item => {
                        if (item.projectPhase === phase) {
                            devHoursPerPhase.push(item.hoursLogged)
                            totalHoursInPhase += item.hoursLogged
                        }
                    })
                    hoursPerPhase.push({
                        name: dev.name,
                        totalHours: devHoursPerPhase?.length
                            ? devHoursPerPhase.reduce(
                                  (accumulator, current) =>
                                      accumulator + current
                              )
                            : 0
                    })
                })

                projects.push({
                    projectPhase: phase,
                    devs: hoursPerPhase,
                    totalHours: totalHoursInPhase
                })
            })

            return buildResponse.user.success.fetchedDevHours({
                totalHours,
                developers,
                projects
            })
        } catch (error) {
            console.log(error)
            throw new Error(error)
        }
    }
}
