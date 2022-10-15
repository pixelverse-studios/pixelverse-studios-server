export default async (req, res) => {
    console.log('all users return here')
    return res.status(200).json({ users: [1, 2] })
}
