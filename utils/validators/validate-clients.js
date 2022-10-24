const { VALID_EMAIL } = require('../regex')

module.exports.validateNewClientFields = ({
    email,
    firstName,
    lastName,
    introMeeting
}) => {
    const errors = []

    if (!email) {
        errors.push({ field: 'Email', error: 'Email is required' })
    } else if (email && !VALID_EMAIL.test(email)) {
        errors.push({ field: 'Email', error: 'Invalid email format' })
    }

    if (!firstName) {
        errors.push({ field: 'First Name', error: 'First Name is required' })
    }

    if (!lastName) {
        errors.push({ field: 'Last Name', error: 'Last Name is required' })
    }

    if (!introMeeting) {
        errors.push({
            field: 'Intro Meeting',
            error: 'Intro Meeting details are required'
        })
    }

    return {
        valid: errors?.length <= 0,
        errors
    }
}
