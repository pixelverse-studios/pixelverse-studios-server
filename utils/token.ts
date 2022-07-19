import jwt from 'jsonwebtoken'

export const generateToken = (user: any) => {
    const userData = {
        id: user._id,
        email: user.email
    }

    return jwt.sign({ ...userData }, process.env?.TOKEN_SECRET ?? '', {
        expiresIn: process.env?.TOKEN_EXPIRE ?? '24hr'
    })
}

export const generateResetPwToken = (user: any) => {
    const userData = {
        id: user._id,
        email: user.email
    }

    return jwt.sign({ ...userData }, process.env?.TOKEN_SECRET ?? '', {
        expiresIn: process.env?.TOKEN_EXPIRE ?? '1hr'
    })
}

const isTokenExpired = (expiration: number): boolean => {
    if (expiration * 1000 < Date.now()) return false

    return true
}

export const validateToken = (context: any): { valid: boolean; user: any } => {
    const { user } = context
    if (!user) {
        return {
            valid: false,
            user
        }
    }

    return {
        valid: isTokenExpired(user.exp),
        user
    }
}
