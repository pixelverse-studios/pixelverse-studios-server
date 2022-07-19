import { UserInputError } from 'apollo-server'
import bcrypt from 'bcryptjs'

import User from '../../models/User'
import { validateAuthUser } from '../../utils/validators'
import { VALID_PASSWORD } from '../../utils/regex'
import {
    generateToken,
    generateResetPwToken,
    validateToken
} from '../../utils/token'
import resetPassword from '../../utils/mailer/resetPassword'

export const Mutation = {
    async register(
        _: any,
        { email, password }: { email: string; password: string }
    ) {
        try {
            const { valid, errors } = validateAuthUser(email, password)
            if (!valid) {
                throw new UserInputError('Registration Errors', { errors })
            }

            const user = await User.findOne({ email })
            if (user) {
                throw new UserInputError('User Exists', {
                    errors: {
                        email: 'User already exists with these credentials'
                    }
                })
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
        } catch (error: any) {
            return new Error(error)
        }
    },
    async login(
        _: any,
        { email, password }: { email: string; password: string }
    ) {
        const { errors, valid } = validateAuthUser(email, password)
        if (!valid) {
            throw new UserInputError('Login Error', { errors })
        }

        try {
            const sanitizedEmail = email.toLowerCase()
            const user = await User.findOne({ email: sanitizedEmail })

            if (!user) {
                throw new UserInputError(
                    'User not found. Try another email, or create an account with us.',
                    {
                        invalid: email
                    }
                )
            }

            const passwordMatches = await bcrypt.compare(
                password,
                user.password
            )
            if (!passwordMatches) {
                throw new UserInputError('Wrong password', {
                    errors: {
                        general: 'Invalid credentials'
                    }
                })
            }

            const token = generateToken(user)
            console.log('token: ', token)
            return {
                ...user._doc,
                id: user._id,
                token
            }
        } catch (error: any) {
            return new Error(error)
        }
    },
    async updateUser(
        _: any,
        {
            firstName,
            lastName,
            email
        }: {
            email: string
            firstName: string
            lastName: string
        },
        context: any
    ) {
        const token = validateToken(context)

        if (!token.valid) {
            throw new Error('Invalid User Token')
        }

        if (!email) {
            throw new UserInputError('Invalid Credentials', {
                errors: {
                    general: 'Email is required'
                }
            })
        }

        try {
            const sanitizedEmail = email.toLowerCase()
            const user = await User.findOne({ email: sanitizedEmail })

            if (!user) {
                throw new UserInputError('Not Found', {
                    errors: { general: 'User not found' }
                })
            }

            user.firstName = firstName ?? user.firstName
            user.lastName = lastName ?? user.lastName

            const updated = await user.save()
            const token = generateToken(user)
            return { ...updated._doc, id: updated._id, token }
        } catch (error: any) {
            return new Error(error)
        }
    },
    async updatePassword(
        _: any,
        {
            email,
            newPassword
        }: {
            email: string
            newPassword: string
        }
    ) {
        if (!VALID_PASSWORD.test(newPassword)) {
            throw new UserInputError('Invalid Credentials', {
                errors: {
                    password: 'Invalid password'
                }
            })
        }

        if (!newPassword || !email) {
            throw new UserInputError('Invalid credentials')
        }

        try {
            const sanitizedEmail = email.toLocaleLowerCase()
            const user = await User.findOne({ email: sanitizedEmail })

            if (!user) {
                throw new UserInputError('User not found')
            }

            const isSamePassword = bcrypt.compareSync(
                newPassword,
                user.password
            )

            if (isSamePassword) {
                throw new UserInputError('Matching Passwords', {
                    errors: {
                        password:
                            "Your new password can't match your previous password"
                    }
                })
            }

            bcrypt.genSalt(12, (err, salt) => {
                bcrypt.hash(newPassword, salt, async (err, hash) => {
                    user.password = hash
                    await user.save()
                })
            })
            const token = generateToken(user)

            return { ...user._doc, id: user._id, token }
        } catch (error: any) {
            return new Error(error)
        }
    },
    async deleteUser(_: any, { id }: { id: string }) {
        try {
            const userToDelete = await User.findById(id)
            await userToDelete.delete()
            const users = await User.find()
            return users
        } catch (error: any) {
            return new Error(error)
        }
    },
    async sendPasswordResetEmail(_: any, { email }: { email: string }) {
        try {
            const user = await User.find({ email })
            if (!user) {
                throw new UserInputError('User not found', {
                    errors: {
                        password:
                            'No user was found with that email. Please try again, or register for an account'
                    }
                })
            }
            const token = generateResetPwToken(user[0])
            await resetPassword(email, token)
            return [...user]
        } catch (error: any) {
            throw new Error(error)
        }
    }
}

export const Query = {
    async getUser(_: any, { email }: { email: string }) {
        try {
            const user = await User.findOne({ email })
            if (user) {
                return user
            }
            throw new UserInputError("User Doesn't Exist ", {
                errors: {
                    user: 'No user found with those credentials'
                }
            })
        } catch (error: any) {
            throw new Error(error)
        }
    },
    async getLoggedInUser(_: any, {}, context: any) {
        try {
            const token = validateToken(context)

            if (!token.valid) {
                throw new Error('Invalid User Token')
            }

            const user = await User.findOne({ email: token.user.email })

            return user
        } catch (error: any) {
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
        } catch (error: any) {
            throw new Error(error)
        }
    }
}
