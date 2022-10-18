export default async (req, res) => {
    console.log(req.body)
    return res.status(200).json('user profile')
}
