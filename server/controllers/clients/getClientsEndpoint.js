import axios from 'axios'

import Clients from '../../models/Clients.js'
import { phases } from './utils.js'
import {
    handleSuccessWithReturnData,
    handleInternalError
} from '../../../utils/buildResponse.js'

export default async (req, res) => {
    try {
        const clients = await Clients.find()
        handleSuccessWithReturnData({ res, data: clients })
    } catch (error) {
        console.log(error)
    }
}
