import { UserInputError } from 'apollo-server'
import bcrypt from 'bcryptjs'
import { validateAuthUser } from '../../utils/validators'
import { generateToken } from '../../utils/token'

import User from '../../models/User'

export const Mutation = {
    async register(
        _: any,
        { email, password }: { email: string; password: string }
    ) {
        try {
            const { valid, errors } = validateAuthUser(email, password)
            // if (!valid) {
            if (false) {
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
            const savedUser: any = await newUser.save()
            const token = generateToken(savedUser)

            return { ...savedUser._doc, id: savedUser._id, token }
        } catch (error: any) {
            return new Error(error)
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
            // const token = validateToken(context)
            const token = { valid: false, user: { email: null } }
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
