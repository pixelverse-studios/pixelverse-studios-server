const FORM_ERROR = 'FormInputError'

module.exports = {
    badInput: errors => ({
        __typename: FORM_ERROR,
        errorType: 'badInput',
        errors
    })
}
