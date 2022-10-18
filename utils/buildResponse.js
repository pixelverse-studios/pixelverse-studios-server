const HTTP_CODES = {
    OK: 200,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_SERVER: 500
}

export const handleSuccessWithReturnData = ({ res, data }) => {
    return res.status(HTTP_CODES.OK).json(data)
}

export const handleInternalError = ({ res, error }) => {
    console.log(error)
    // error.status(HTTP_CODES.INTERNAL_SERVER)
    // throw new Error({ status: HTTP_CODES.INTERNAL_SERVER })

    return res.status(HTTP_CODES.INTERNAL_SERVER)
}
