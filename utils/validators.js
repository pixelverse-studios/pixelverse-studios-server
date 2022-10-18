import { VALID_EMAIL, VALID_PASSWORD } from './regex'

export const validateAuthUser = (email, password) => {
    const errors = {
        email: '',
        password: ''
    }

    if (email.trim() === '') {
        errors.email = 'Email is required'
    } else if (!VALID_EMAIL.test(email)) {
        errors.email = 'Invalid email'
    }

    if (password.trim() === '') {
        errors.password = 'A password is required'
    } else if (VALID_PASSWORD.test(password)) {
        errors.password = 'Invalid password'
    }

    const isValid = Object.values(errors).some(value => value !== '')
    return {
        valid: isValid,
        errors
    }
}

export const validateRequiredFields = data => {
    const errors = {
        general: ''
    }

    const missingValues = []

    for (const [key, value] of Object.entries(data)) {
        if (!value) {
            missingValues.push(key)
        }
    }

    const isValid = missingValues.length <= 0

    if (!isValid) {
        errors.general = `Missing values for: ${missingValues.join()}`
    }

    return {
        valid: isValid,
        errors
    }
}
