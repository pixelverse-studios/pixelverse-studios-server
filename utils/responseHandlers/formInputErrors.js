const FORM_ERROR = 'FormInputError'

module.exports = {
    formInputError: errors => ({
        __typename: FORM_ERROR,
        errorType: 'badInput',
        errors
    })
}
